import type { Pipeline, PipelineNode } from '@harness-x/protocol';
import { currentItemOf } from '../ledger.js';
import {
  AcceptanceSchema,
  CHECKLIST_SCHEMA_VERSION,
  ChecklistItemSchema,
  type Checklist,
  type ChecklistItem,
  type ChecklistItemInput,
} from '../schema.js';
import {
  MAX_STAGE_DEPTH,
  STAGE_TREE_SCHEMA_VERSION,
  StageTreeSchema,
  type ExitCriteria,
  type Stage,
  type StageStatus,
  type StageTree,
} from './schema.js';
import { ACTIVE_STAGE_STATUSES, assertStageTransition, isStageSettled } from './state.js';

/**
 * 단계 트리 만들기·걷기 (T-101 4A·4B.1·4E)
 *
 * 단계 뼈대를 만드는 시점과 근거 (미리 추측해서 만들지 않음)
 *  - `/`로 에이전트를 골라 실행 → 실행 버튼을 누른 순간, 그 에이전트 파이프라인의 단계 그대로
 *  - 에이전트 없이 그냥 지시 → 단계 1개짜리 트리("작업")
 *  - 분기(router) → 도착 전엔 모든 길이 "예상", 도착하면 안 고른 길은 건너뜀
 *  - 반복(loop) → 회차가 실제로 돌 때마다 하나씩 추가
 *  - 실행 중 `/`로 다른 에이전트 → 부르는 순간 현재 단계 아래에 그 에이전트 트리
 * AI가 스스로 단계를 나누는 기능은 없다. 단계는 오직 에이전트 파일에 적힌 것만 쓴다.
 */

export const TASK_STAGE_ID = 'task';
export const TASK_STAGE_TITLE = '작업';

/** 단계가 되는 노드 (fanout·router는 구조만, loop는 회차 묶음) */
const STAGE_NODE_TYPES = new Set(['role', 'gate', 'join', 'subagent', 'loop']);

export type TemplateFn = (node: PipelineNode) => ChecklistItemInput[] | undefined;

export interface AgentRef {
  name: string;
  pipeline: Pipeline;
}

export interface SkeletonInput {
  sessionId: string;
  /** 실행할 에이전트 (없으면 단계 1개) */
  agent?: AgentRef | null;
  /** 노드 checklistTemplate → 고정 항목 (예상으로 표시) */
  templates?: TemplateFn;
  /** 에이전트 없는 세션의 기존 항목 (단계 1개 트리에 그대로) */
  items?: readonly ChecklistItemInput[];
  now?: () => Date;
}

// ── 노드 → 단계 ───────────────────────────────────────────────
function nodeTitle(n: PipelineNode): string {
  return n.label ?? n.id;
}

function exitOf(n: PipelineNode): ExitCriteria {
  const outputSchema = 'outputSchema' in n ? n.outputSchema : undefined;
  const raw = 'acceptance' in n ? ((n as { acceptance?: unknown[] }).acceptance ?? []) : [];
  return {
    ...(outputSchema ? { outputSchema } : {}),
    acceptance: raw.map((a) => AcceptanceSchema.parse(a)),
  };
}

function scopeOf(n: PipelineNode) {
  const x = n as { artifacts?: string[]; canModify?: string[] };
  return { artifacts: [...(x.artifacts ?? [])], canModify: [...(x.canModify ?? [])] };
}

function templateItems(n: PipelineNode, templates?: TemplateFn): Pick<Stage, 'items' | 'itemMeta'> {
  const raw = templates?.(n) ?? [];
  const items = raw.map((i) => ChecklistItemSchema.parse(i));
  return { items, itemMeta: Object.fromEntries(items.map((i) => [i.id, { origin: 'template' as const }])) };
}

function blankStage(o: Partial<Stage> & Pick<Stage, 'stageId' | 'title' | 'kind'>): Stage {
  return {
    nodeId: null,
    status: 'expected',
    exitCriteria: { acceptance: [] },
    items: [],
    itemMeta: {},
    waitFor: [],
    scope: { artifacts: [], canModify: [] },
    failures: 0,
    children: [],
    ...o,
  };
}

function nodeStage(n: PipelineNode, prefix: string, templates?: TemplateFn): Stage {
  const kind = n.type as Stage['kind'];
  return blankStage({
    stageId: prefix + n.id,
    nodeId: n.id,
    title: nodeTitle(n),
    kind,
    exitCriteria: exitOf(n),
    scope: scopeOf(n),
    ...(n.type === 'role' || n.type === 'gate' ? templateItems(n, templates) : {}),
    ...(n.type === 'loop' ? { maxIterations: n.maxIterations } : {}),
    ...(n.type === 'subagent' ? { agent: n.agent.replace(/^\//, '') } : {}),
    ...('engine' in n && n.engine && n.engine !== 'auto' ? { engineId: n.engine } : {}),
  });
}

// ── 그래프 도우미 ─────────────────────────────────────────────
export interface PipelineShape {
  /** 위상 순서 (loop 본문 제외) */
  order: string[];
  /** loop id → 본문 노드 (위상 순서) */
  loopBody: Map<string, string[]>;
  /** 노드 → fanout 갈래 (fanout id) */
  fanoutOf: Map<string, string>;
  /** join id → 기다리는 노드 */
  joinWaits: Map<string, string[]>;
  /** 노드 → 분기 갈래 */
  routeOf: Map<string, { router: string; to: string; when?: string }>;
}

function outs(p: Pipeline, id: string) {
  return p.edges.filter((e) => e.from === id && !e.onFail);
}

function reach(p: Pipeline, from: string, blocked: (id: string) => boolean = () => false): Set<string> {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of outs(p, id)) if (!blocked(e.to)) stack.push(e.to);
  }
  return seen;
}

function entryOf(p: Pipeline): string {
  if (p.entry) return p.entry;
  const root = p.nodes.find((n) => !p.edges.some((e) => !e.onFail && e.to === n.id));
  return (root ?? p.nodes[0]!).id;
}

export function pipelineShape(p: Pipeline): PipelineShape {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  // loop 본문: loop에서 닿고 loop로 돌아오는 노드
  const loopBody = new Map<string, string[]>();
  const inBody = new Map<string, string>();
  for (const n of p.nodes) {
    if (n.type !== 'loop') continue;
    const fwd = reach(p, n.id);
    const body = [...fwd].filter((id) => id !== n.id && reach(p, id).has(n.id));
    loopBody.set(n.id, body);
    for (const b of body) if (!inBody.has(b)) inBody.set(b, n.id);
  }
  // 위상 순서 (body → loop 되돌림 엣지는 제외)
  const isBack = (from: string, to: string) => byId.get(to)?.type === 'loop' && inBody.get(from) === to;
  const edges = p.edges.filter((e) => !e.onFail && !isBack(e.from, e.to));
  const indeg = new Map(p.nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const entry = entryOf(p);
  const queue = [entry, ...p.nodes.map((n) => n.id).filter((id) => id !== entry && indeg.get(id) === 0)];
  const topo: string[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    topo.push(id);
    for (const e of edges.filter((x) => x.from === id)) {
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  for (const n of p.nodes) if (!seen.has(n.id)) topo.push(n.id);
  for (const [loop, body] of loopBody)
    loopBody.set(
      loop,
      topo.filter((id) => body.includes(id)),
    );

  const fanoutOf = new Map<string, string>();
  const joinWaits = new Map<string, string[]>();
  for (const n of p.nodes) {
    if (n.type !== 'join') continue;
    const ins = p.edges.filter((e) => e.to === n.id && !e.onFail).map((e) => e.from);
    const waits = new Set<string>();
    for (const f of p.nodes.filter((x) => x.type === 'fanout')) {
      if (!reach(p, f.id).has(n.id)) continue;
      for (const head of outs(p, f.id).map((e) => e.to)) {
        for (const id of reach(p, head, (x) => x === n.id)) {
          if (id === n.id) continue;
          if (!fanoutOf.has(id)) fanoutOf.set(id, f.id);
          if (STAGE_NODE_TYPES.has(byId.get(id)!.type)) waits.add(id);
        }
      }
    }
    for (const i of ins) if (STAGE_NODE_TYPES.has(byId.get(i)!.type)) waits.add(i);
    joinWaits.set(n.id, [...waits]);
  }

  const routeOf = new Map<string, { router: string; to: string; when?: string }>();
  for (const r of p.nodes.filter((x) => x.type === 'router')) {
    const branches = outs(p, r.id);
    const sets = branches.map((e) => reach(p, e.to));
    const common = sets.length ? [...sets[0]!].filter((id) => sets.every((s) => s.has(id))) : [];
    branches.forEach((e, k) => {
      for (const id of sets[k]!) {
        if (common.includes(id) || routeOf.has(id)) continue;
        routeOf.set(id, { router: r.id, to: e.to, ...(e.when ? { when: e.when } : {}) });
      }
    });
  }
  return { order: topo.filter((id) => !inBody.has(id)), loopBody, fanoutOf, joinWaits, routeOf };
}

/** 파이프라인 → 단계 목록 (prefix: 중첩 시 부모 단계 id + '.') */
export function stagesFromPipeline(p: Pipeline, templates?: TemplateFn, prefix = ''): Stage[] {
  const shape = pipelineShape(p);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const decorate = (s: Stage, id: string, pre: string): Stage => {
    const f = shape.fanoutOf.get(id);
    const r = shape.routeOf.get(id);
    const w = shape.joinWaits.get(id);
    return {
      ...s,
      ...(f ? { fanout: f } : {}),
      ...(r ? { route: r } : {}),
      ...(w ? { waitFor: w.map((x) => pre + x) } : {}),
    };
  };
  const out: Stage[] = [];
  for (const id of shape.order) {
    const n = byId.get(id)!;
    if (!STAGE_NODE_TYPES.has(n.type)) continue;
    const s = decorate(nodeStage(n, prefix, templates), id, prefix);
    if (n.type === 'loop') s.children = [iterationStage(p, s, 1, templates)];
    out.push(s);
  }
  return out;
}

/** 반복 회차 단계 (본문 노드를 회차마다 복사) */
export function iterationStage(p: Pipeline, loop: Stage, n: number, templates?: TemplateFn): Stage {
  const shape = pipelineShape(p);
  const byId = new Map(p.nodes.map((x) => [x.id, x]));
  const pre = `${loop.stageId}.${n}.`;
  const body = (shape.loopBody.get(loop.nodeId!) ?? [])
    .map((id) => byId.get(id)!)
    .filter((x) => STAGE_NODE_TYPES.has(x.type))
    .map((x) => ({ ...nodeStage(x, pre, templates), iteration: n }));
  return blankStage({
    stageId: `${loop.stageId}.${n}`,
    nodeId: null,
    title: `반복 ${n}`,
    kind: 'iteration',
    iteration: n,
    children: body,
  });
}

// ── 4B.1 실행 시작 순간의 뼈대 ─────────────────────────────────
/**
 * 실행이 시작되는 순간에만 부른다(에이전트가 정해진 뒤 / 지시를 보낸 뒤).
 * 에이전트가 있으면 파이프라인 단계 그대로, 없으면 단계 1개("작업").
 * 모든 단계는 "예상"으로 시작하고, 노드 checklistTemplate 항목은 예상 항목으로 붙는다.
 */
export function buildSkeleton(i: SkeletonInput): StageTree {
  const now = (i.now ?? (() => new Date()))().toISOString();
  const stages = i.agent
    ? stagesFromPipeline(i.agent.pipeline, i.templates)
    : [
        blankStage({
          stageId: TASK_STAGE_ID,
          nodeId: null,
          title: TASK_STAGE_TITLE,
          kind: 'task',
          items: (i.items ?? []).map((x) => ChecklistItemSchema.parse(x)),
          itemMeta: Object.fromEntries((i.items ?? []).map((x) => [x.id, { origin: 'ledger' as const }])),
        }),
      ];
  return StageTreeSchema.parse({
    schemaVersion: STAGE_TREE_SCHEMA_VERSION,
    sessionId: i.sessionId,
    agent: i.agent?.name ?? null,
    pipeline: i.agent?.pipeline.name ?? null,
    createdAt: now,
    updatedAt: now,
    stages,
  });
}

// ── 걷기 ─────────────────────────────────────────────────────
/** 깊이 우선으로 모든 단계 */
export function allStages(t: Pick<StageTree, 'stages'>): Stage[] {
  const out: Stage[] = [];
  const walk = (l: readonly Stage[]) => {
    for (const s of l) {
      out.push(s);
      walk(s.children);
    }
  };
  walk(t.stages);
  return out;
}

export function findStage(t: Pick<StageTree, 'stages'>, stageId: string): Stage | undefined {
  return allStages(t).find((s) => s.stageId === stageId);
}

export class StageNotFoundError extends Error {
  readonly code = 'STAGE_NOT_FOUND';
  constructor(readonly stageId: string) {
    super(`단계를 찾을 수 없습니다: ${stageId}`);
    this.name = 'StageNotFoundError';
  }
}

export function getStage(t: Pick<StageTree, 'stages'>, stageId: string): Stage {
  const s = findStage(t, stageId);
  if (!s) throw new StageNotFoundError(stageId);
  return s;
}

/** 단계 id 기준 부모 (최상위면 undefined) */
export function parentStage(t: Pick<StageTree, 'stages'>, stageId: string): Stage | undefined {
  return allStages(t).find((s) => s.children.some((c) => c.stageId === stageId));
}

/** 노드 id(+회차)에 맞는 단계: 진행 중인 회차·하위 트리 안을 먼저 본다 */
export function stageForNode(t: Pick<StageTree, 'stages'>, nodeId: string, prefix = ''): Stage | undefined {
  const cands = allStages(t).filter((s) => s.nodeId === nodeId && s.stageId.startsWith(prefix));
  return (
    cands.find((s) => ACTIVE_STAGE_STATUSES.includes(s.status)) ??
    cands.find((s) => s.status === 'expected') ??
    cands.at(-1)
  );
}

/** 트리 복사 (함수들은 복사본을 고쳐서 돌려준다) */
export function cloneTree(t: StageTree): StageTree {
  return structuredClone(t);
}

function touch(t: StageTree, now?: () => Date): StageTree {
  t.updatedAt = (now ?? (() => new Date()))().toISOString();
  return t;
}

/** 단계 상태 바꾸기 (전이표 검사) */
export function setStageStatus(
  t: StageTree,
  stageId: string,
  to: StageStatus,
  o: { reason?: string; now?: () => Date } = {},
): StageTree {
  const next = cloneTree(t);
  const s = getStage(next, stageId);
  assertStageTransition(stageId, s.status, to);
  s.status = to;
  if (o.reason !== undefined) s.reason = o.reason;
  return touch(next, o.now);
}

/** 단계 시작 순서대로 상태를 몰아 간다 (expected → … → target) */
export function advanceStage(
  t: StageTree,
  stageId: string,
  target: 'planning' | 'locked' | 'running',
  now?: () => Date,
): StageTree {
  const path: StageStatus[] = ['expected', 'planning', 'locked', 'running'];
  let cur = t;
  const s = getStage(cur, stageId);
  if (s.status === 'reopened' && target === 'running')
    return setStageStatus(cur, stageId, 'running', { now });
  const from = path.indexOf(s.status);
  const to = path.indexOf(target);
  if (from < 0) return cur;
  for (let k = from + 1; k <= to; k++) cur = setStageStatus(cur, stageId, path[k]!, { now });
  return cur;
}

// ── 단계 1개 트리 (4A.4) ──────────────────────────────────────
/** 기존 원장(checklist.json) → 단계 1개 트리. 상태는 항목 상태에서 정한다 */
export function treeFromChecklist(sessionId: string, c: Checklist | null, now?: () => Date): StageTree {
  const t = buildSkeleton({ sessionId, items: c?.items ?? [], ...(now ? { now } : {}) });
  const s = t.stages[0]!;
  s.status = taskStatusOf(s.items);
  return t;
}

function taskStatusOf(items: readonly ChecklistItem[]): StageStatus {
  if (!items.length) return 'running';
  if (items.every((i) => i.status === 'done')) return 'done';
  if (items.every((i) => i.status === 'done' || i.status === 'blocked')) return 'blocked';
  return 'running';
}

/** 단계 1개 트리의 항목을 원장과 맞춘다 (원장이 하위 항목의 원본) */
export function syncStageItems(
  t: StageTree,
  stageId: string,
  items: readonly ChecklistItem[],
  now?: () => Date,
): StageTree {
  const next = cloneTree(t);
  const s = getStage(next, stageId);
  s.items = items.map((i) => ChecklistItemSchema.parse(i));
  for (const i of s.items) s.itemMeta[i.id] ??= { origin: 'ledger' };
  for (const id of Object.keys(s.itemMeta)) if (!s.items.some((i) => i.id === id)) delete s.itemMeta[id];
  if (s.kind === 'task' && next.stages.length === 1) s.status = taskStatusOf(s.items);
  return touch(next, now);
}

/** 단계 하위 항목 → 기존 checklist 문서 (린터·판정·원장 함수에 그대로 넘긴다, 4F.1) */
export function stageChecklist(s: Stage, now?: () => Date): Checklist {
  return {
    schemaVersion: CHECKLIST_SCHEMA_VERSION,
    revision: 1,
    version: 0,
    updatedAt: (now ?? (() => new Date()))().toISOString(),
    items: s.items,
  };
}

// ── 현재 단계 ─────────────────────────────────────────────────
/** 진행 중인 가장 안쪽 단계 (없으면 다음 예상 단계) */
export function currentStage(t: Pick<StageTree, 'stages'>): Stage | null {
  const leaf = (s: Stage): Stage => {
    const inner = s.children.find((c) => ACTIVE_STAGE_STATUSES.includes(c.status));
    return inner ? leaf(inner) : s;
  };
  const active = t.stages.find((s) => ACTIVE_STAGE_STATUSES.includes(s.status));
  if (active) return leaf(active);
  const blocked = t.stages.find((s) => s.status === 'blocked');
  if (blocked) return leaf(blocked);
  return t.stages.find((s) => s.status === 'expected') ?? null;
}

/** 최상위 단계 기준 현재 단계 */
export function currentTopStage(t: Pick<StageTree, 'stages'>): Stage | null {
  return (
    t.stages.find((s) => ACTIVE_STAGE_STATUSES.includes(s.status)) ??
    t.stages.find((s) => s.status === 'blocked') ??
    t.stages.find((s) => s.status === 'expected') ??
    null
  );
}

/** 현재 진행할 하위 항목 */
export function currentStageItem(t: Pick<StageTree, 'stages'>): { stage: Stage; item: ChecklistItem } | null {
  const s = currentStage(t);
  if (!s) return null;
  const item = currentItemOf(stageChecklist(s));
  return item ? { stage: s, item } : null;
}

/** 루트가 끝났는가 (모든 단계 done/skipped) */
export function treeComplete(t: Pick<StageTree, 'stages'>): boolean {
  return allStages(t).every((s) => isStageSettled(s.status) || isUnderSettled(t, s));
}

/** 건너뛴 단계 아래의 단계는 따지지 않는다 */
function isUnderSettled(t: Pick<StageTree, 'stages'>, s: Stage): boolean {
  let p = parentStage(t, s.stageId);
  while (p) {
    if (p.status === 'skipped') return true;
    p = parentStage(t, p.stageId);
  }
  return false;
}

// ── 4E.4 하위 에이전트 / 실행 중 `/` 호출 ───────────────────────
export class StageDepthError extends Error {
  readonly code = 'STAGE_DEPTH';
  constructor(readonly stageId: string) {
    super(`하위 에이전트는 ${MAX_STAGE_DEPTH}단계까지만 넣을 수 있어요 (${stageId})`);
    this.name = 'StageDepthError';
  }
}

/** 단계의 하위 에이전트 깊이 (최상위 에이전트 = 1) */
export function stageDepth(t: Pick<StageTree, 'stages'>, stageId: string): number {
  let d = 1;
  let p = parentStage(t, stageId);
  const self = findStage(t, stageId);
  if (self?.kind === 'subagent') d++;
  while (p) {
    if (p.kind === 'subagent') d++;
    p = parentStage(t, p.stageId);
  }
  return d;
}

/**
 * 부르는 순간 그 에이전트 트리를 단계 아래에 넣는다.
 * underStageId가 subagent 단계면 그 단계 아래, 다른 단계면(실행 중 `/` 호출) 그 아래에 subagent 단계를 하나 만들어 넣는다.
 */
export function attachAgentTree(
  t: StageTree,
  underStageId: string,
  agent: AgentRef,
  o: { templates?: TemplateFn; now?: () => Date } = {},
): StageTree {
  const next = cloneTree(t);
  const under = getStage(next, underStageId);
  let host = under;
  if (under.kind !== 'subagent') {
    host = blankStage({
      stageId: `${under.stageId}.${agent.name.replace(/[^a-z0-9-]/g, '') || 'agent'}`,
      nodeId: null,
      title: agent.pipeline.displayName ?? agent.name,
      kind: 'subagent',
      agent: agent.name,
      status: 'running',
    });
    under.children.push(host);
  }
  if (stageDepth(next, host.stageId) > MAX_STAGE_DEPTH) throw new StageDepthError(host.stageId);
  host.children = stagesFromPipeline(agent.pipeline, o.templates, `${host.stageId}.`);
  return touch(StageTreeSchema.parse(next), o.now);
}

// ── 4E.2 반복 ────────────────────────────────────────────────
/** 회차 n이 실제로 돌기 시작할 때: 회차 n을 진행 중으로, 최대 회차 전이면 n+1을 예상으로 하나 추가 */
export function startIteration(
  t: StageTree,
  loopStageId: string,
  n: number,
  p: Pipeline,
  o: { templates?: TemplateFn; now?: () => Date } = {},
): StageTree {
  let next = cloneTree(t);
  const loop = getStage(next, loopStageId);
  if (loop.status === 'expected') next = advanceStage(next, loopStageId, 'running', o.now);
  const lp = getStage(next, loopStageId);
  const max = lp.maxIterations ?? n;
  if (n > max) throw new Error(`반복 ${loopStageId}: 최대 ${max}회를 넘었어요`);
  if (!lp.children.some((c) => c.iteration === n)) lp.children.push(iterationStage(p, lp, n, o.templates));
  const it = lp.children.find((c) => c.iteration === n)!;
  if (it.status === 'expected') {
    it.status = 'running';
    // 본문 단계는 실행기가 들어갈 때 시작한다
  }
  if (n < max && !lp.children.some((c) => c.iteration === n + 1))
    lp.children.push(iterationStage(p, lp, n + 1, o.templates));
  return touch(next, o.now);
}

/** 반복이 끝났을 때: 회차 n까지 done, 남은 예상 회차는 skipped + 이유, 반복 단계 done 직전(verifying)까지 */
export function endLoop(
  t: StageTree,
  loopStageId: string,
  o: { reason: string; now?: () => Date },
): StageTree {
  const next = cloneTree(t);
  const lp = getStage(next, loopStageId);
  for (const it of lp.children) {
    if (it.status === 'expected') {
      it.status = 'skipped';
      it.reason = o.reason;
      for (const c of allStages({ stages: it.children })) if (c.status === 'expected') c.status = 'skipped';
    } else if (!isStageSettled(it.status) && it.children.every((c) => isStageSettled(c.status)))
      it.status = 'done';
  }
  return touch(next, o.now);
}

// ── 4E.3 분기 ────────────────────────────────────────────────
export const ROUTE_SKIP_REASON = (chosen: string) => `다른 길(${chosen})을 골라서 건너뛰었어요.`;

/** 분기 지점에 도착했을 때: 고른 길만 남기고 나머지 길의 단계는 skipped + 이유 */
export function chooseRoute(
  t: StageTree,
  routerNodeId: string,
  chosenTo: string,
  o: { now?: () => Date; prefix?: string } = {},
): StageTree {
  const next = cloneTree(t);
  for (const s of allStages(next)) {
    if (!s.route || s.route.router !== routerNodeId || !s.stageId.startsWith(o.prefix ?? '')) continue;
    if (s.route.to === chosenTo) continue;
    if (s.status !== 'expected') continue;
    s.status = 'skipped';
    s.reason = ROUTE_SKIP_REASON(chosenTo);
    for (const c of allStages({ stages: s.children })) if (c.status === 'expected') c.status = 'skipped';
  }
  return touch(next, o.now);
}

// ── 4E.1 병렬 ────────────────────────────────────────────────
/** 단계를 시작해도 되는가: join은 기다리는 단계가 모두 끝나야 */
export function canStartStage(
  t: Pick<StageTree, 'stages'>,
  stageId: string,
): { ok: boolean; waiting: string[] } {
  const s = getStage(t, stageId);
  const waiting = s.waitFor.filter((id) => {
    const w = findStage(t, id);
    return w ? !isStageSettled(w.status) : false;
  });
  return { ok: waiting.length === 0, waiting };
}

export function stageLabel(s: Pick<Stage, 'title' | 'kind'>): string {
  return s.kind === 'iteration' || s.kind === 'task' ? s.title : `${s.title} 단계`;
}
