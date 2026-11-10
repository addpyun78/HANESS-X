import type { PipelineEdge, PipelineInput, PipelineNodeInput } from '@harness-x/protocol';

/**
 * 46.4 "시험 실행" 드라이런 (엔진을 부르지 않는다 — 비용 0)
 * - dryRunEvents: 리플레이 엔진. 파이프라인을 실행기(T-041)와 같은 순서 규칙으로 걸으며
 *   실제 실행과 같은 모양의 이벤트(node_start → usage → node_end)를 만든다. 비용은 엔진별 단가로 추정.
 * - overlayFromEvents: 이벤트(드라이런 또는 실제 세션 로그 리플레이) → 노드별 진행·비용 오버레이
 */

export type OverlayStatus = 'pending' | 'running' | 'completed' | 'incomplete' | 'failed' | 'error';

export interface RunEvent {
  type: 'node_start' | 'node_end' | 'usage' | string;
  nodeId?: string;
  engineId?: string;
  status?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  costEstimated?: boolean;
}

export interface NodeOverlay {
  status: OverlayStatus;
  costUsd: number;
  tokens: number;
  /** 몇 번째로 실행됐는지 (1부터) */
  order?: number;
}

export type Overlay = Record<string, NodeOverlay>;

/** 엔진별 추정 단가 (USD / 1M 토큰: 입력, 출력) */
export const PRICE_PER_MTOK: Record<string, [number, number]> = {
  'claude-code': [3, 15],
  codex: [1.25, 10],
  antigravity: [1.25, 10],
  auto: [3, 15],
};

const OUTPUT_TOKENS = 400;
const SKILL_TOKENS = 200;
const tokensOf = (text: string) => Math.ceil(text.length / 4);

export function estimateCost(engine: string, inputTokens: number, outputTokens: number): number {
  const [i, o] = PRICE_PER_MTOK[engine] ?? PRICE_PER_MTOK.auto!;
  return Math.round(((inputTokens * i + outputTokens * o) / 1e6) * 1e6) / 1e6;
}

const normal = (p: PipelineInput, id: string): PipelineEdge[] =>
  (p.edges ?? []).filter((e) => e.from === id && !e.onFail) as PipelineEdge[];

/** 드라이런 방문 순서: entry부터 일반 엣지로. fanout은 모든 갈래, router는 default(없으면 첫 갈래), loop는 한 바퀴 */
export function dryRunOrder(p: PipelineInput): string[] {
  const edges = p.edges ?? [];
  const root = p.nodes.find((n) => !edges.some((e) => !e.onFail && e.to === n.id)) ?? p.nodes[0];
  const entry = p.entry ?? root?.id;
  if (!entry) return [];
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const order: string[] = [];
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !byId.has(id)) continue;
    // join: 들어오는 갈래가 모두 끝난 뒤
    const node = byId.get(id)!;
    if (node.type === 'join') {
      const ins = (p.edges ?? []).filter((e) => e.to === id && !e.onFail).map((e) => e.from);
      if (ins.some((f) => !seen.has(f) && queue.includes(f))) {
        queue.push(id);
        continue;
      }
    }
    seen.add(id);
    order.push(id);
    const outs = normal(p, id);
    if (node.type === 'router') {
      const pick = outs.find((e) => e.to === node.default) ?? outs[0];
      if (pick) queue.push(pick.to);
    } else if (node.type === 'fanout') queue.push(...outs.map((e) => e.to));
    else {
      const next = outs.find((e) => !seen.has(e.to)) ?? outs[0];
      if (next) queue.push(next.to);
    }
  }
  return order;
}

const engineOf = (n: PipelineNodeInput, fallback: string) =>
  ('engine' in n && n.engine && n.engine !== 'auto' ? n.engine : undefined) ?? fallback;

/** 리플레이 엔진: 샘플 입력으로 실행 이벤트를 만든다 */
export function dryRunEvents(p: PipelineInput, sample: string, defaultEngine = 'auto'): RunEvent[] {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const events: RunEvent[] = [];
  let carried = tokensOf(sample);
  for (const id of dryRunOrder(p)) {
    const n = byId.get(id)!;
    const engineId = n.type === 'role' || n.type === 'subagent' ? engineOf(n, defaultEngine) : undefined;
    events.push({ type: 'node_start', nodeId: id, ...(engineId ? { engineId } : {}) });
    if (engineId) {
      const skills = n.type === 'role' ? (n.skills?.length ?? 0) : 0;
      const prompt = n.type === 'role' ? (n.prompt ?? '') : '';
      const inputTokens = carried + tokensOf(prompt) + skills * SKILL_TOKENS + 50;
      events.push({
        type: 'usage',
        nodeId: id,
        engineId,
        inputTokens,
        outputTokens: OUTPUT_TOKENS,
        costUsd: estimateCost(engineId, inputTokens, OUTPUT_TOKENS),
        costEstimated: true,
      });
      carried = OUTPUT_TOKENS;
    }
    events.push({ type: 'node_end', nodeId: id, status: 'completed', ...(engineId ? { engineId } : {}) });
  }
  return events;
}

const STATUS: Record<string, OverlayStatus> = {
  completed: 'completed',
  max_iterations: 'completed',
  incomplete: 'incomplete',
  failed: 'failed',
  contract_failed: 'failed',
  stalled: 'failed',
  error: 'error',
};

/** 이벤트 → 노드별 오버레이 (usage에 nodeId가 없으면 마지막으로 시작한 노드에 붙인다) */
export function overlayFromEvents(events: readonly RunEvent[], nodeIds: readonly string[] = []): Overlay {
  const o: Overlay = Object.fromEntries(
    nodeIds.map((id) => [id, { status: 'pending' as OverlayStatus, costUsd: 0, tokens: 0 }]),
  );
  let current: string | undefined;
  let order = 0;
  const at = (id: string) => (o[id] ??= { status: 'pending', costUsd: 0, tokens: 0 });
  for (const e of events) {
    if (e.type === 'node_start' && e.nodeId) {
      current = e.nodeId;
      const x = at(e.nodeId);
      x.status = 'running';
      x.order ??= ++order;
    } else if (e.type === 'usage') {
      const id = e.nodeId ?? current;
      if (!id) continue;
      const x = at(id);
      x.costUsd = Math.round((x.costUsd + (e.costUsd ?? 0)) * 1e6) / 1e6;
      x.tokens += (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
    } else if (e.type === 'node_end' && e.nodeId) {
      at(e.nodeId).status = STATUS[e.status ?? 'completed'] ?? 'completed';
      if (current === e.nodeId) current = undefined;
    }
  }
  return o;
}

export const totalCost = (o: Overlay) =>
  Math.round(Object.values(o).reduce((s, x) => s + x.costUsd, 0) * 1e6) / 1e6;

export const formatUsd = (v: number) => `$${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)}`;
