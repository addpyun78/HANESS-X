import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { LogRecord } from '@harness-x/kernel';
import {
  ChecklistLedger,
  StallDetector,
  StopGuard,
  checklistStatus,
  runWithStopGuard,
  type ChecklistItem,
} from '@harness-x/checklist-ledger';
import {
  pipelineEntry,
  type EngineAdapter,
  type EngineRun,
  type FanoutNode,
  type GateNode,
  type HarnessEvent,
  type JoinNode,
  type LoopNode,
  type PermissionMode,
  type Pipeline,
  type PipelineEdge,
  type PipelineNode,
  type RoleNode,
  type RouterNode,
  type SubagentNode,
} from '@harness-x/protocol';
import { evaluateCondition } from './condition.js';
import type {
  GateFailure,
  GateSubject,
  NodeRunContext,
  NodeStatus,
  NodeVisit,
  PipelineRunResult,
  PipelineRunStatus,
  PipelineRunnerOptions,
} from './types.js';

/**
 * 파이프라인 실행기 (T-041)
 * - role: 노드마다 자기 엔진 세션(노드별 엔진 가능). 완료 조건 = 그 노드 체크리스트 전 항목 done
 *         (runWithStopGuard로 미완료 시 다음 항목 재주입). 미완료면 다음 노드로 가지 않는다.
 * - gate: 판정기(verify)가 돌려준 실패 항목만 onFail 노드 원장에서 todo로 되돌려 그 항목만 다시 시킨다.
 * - fanout/join: 나가는 갈래를 병렬 실행(최대 동시 3), 가장 가까운 join에서 모은다.
 * - loop: 본문(loop로 돌아오는 경로)을 until 참 / maxIterations / 정체(출력 무변화 stallLimit회)까지 반복.
 * - router: when 조건이 맞는 첫 엣지(없으면 default).
 * - 일반 노드의 나가는 엣지가 여럿이면 when이 맞는(또는 없는) 첫 엣지로 간다.
 * 노드 진행은 node_start / node_end 기록으로 이벤트 로그에 남긴다.
 */

export const MAX_FANOUT_CONCURRENCY = 3;

const PERMISSION: Record<RoleNode['permission'], PermissionMode> = {
  'read-only': 'read-only',
  'workspace-write': 'workspace-write',
  full: 'full-access',
};

class Halt extends Error {
  constructor(
    readonly status: PipelineRunStatus,
    readonly nodeId: string,
    reason: string,
  ) {
    super(reason);
  }
}

interface Arrival {
  /** stop 집합의 노드에 도착했으면 그 id */
  at?: string;
  value: unknown;
}

export function stableHash(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object')
      return Object.fromEntries(
        Object.keys(x as object)
          .sort()
          .map((k) => [k, norm((x as Record<string, unknown>)[k])]),
      );
    return x;
  };
  return createHash('sha256')
    .update(JSON.stringify(norm(v)) ?? 'undefined')
    .digest('hex');
}

/** 기본 출력 추출: 마지막 최종 assistant 텍스트 */
export function lastAssistantText(events: readonly HarnessEvent[]): string {
  const finals = events.filter((e) => e.type === 'assistant_text' && !e.partial);
  const last = finals[finals.length - 1];
  return last && last.type === 'assistant_text' ? last.text : '';
}

export class PipelineRunner {
  readonly sessionId: string;
  private readonly opts: PipelineRunnerOptions;
  private readonly idGen: () => string;
  private readonly now: () => Date;
  private pipeline!: Pipeline;
  private byId = new Map<string, PipelineNode>();
  private visitCount = new Map<string, number>();
  private latest = new Map<string, { visit: NodeVisit; ledger?: ChecklistLedger; engine?: EngineAdapter }>();
  private visits: NodeVisit[] = [];
  private outputs: Record<string, unknown> = {};
  private input: unknown;

  constructor(opts: PipelineRunnerOptions) {
    this.opts = opts;
    this.idGen = opts.idGen ?? randomUUID;
    this.now = opts.now ?? (() => new Date());
    this.sessionId = opts.sessionId ?? `run-${randomUUID()}`;
  }

  // ── 공개 API ───────────────────────────────────────────────
  async run(pipeline: Pipeline, input: unknown = {}): Promise<PipelineRunResult> {
    this.pipeline = pipeline;
    this.byId = new Map(pipeline.nodes.map((n) => [n.id, n]));
    this.input = typeof input === 'string' ? { request: input } : input;
    let status: PipelineRunStatus = 'completed';
    let haltedAt: string | undefined;
    let reason: string | undefined;
    let result: unknown;
    try {
      const a = await this.runFrom(pipelineEntry(pipeline), this.input, new Set());
      result = a.value;
    } catch (err) {
      if (!(err instanceof Halt)) throw err;
      status = err.status;
      haltedAt = err.nodeId;
      reason = err.message;
    }
    return {
      sessionId: this.sessionId,
      status,
      outputs: this.outputs,
      visits: this.visits,
      result,
      ...(haltedAt ? { haltedAt } : {}),
      ...(reason ? { reason } : {}),
    };
  }

  // ── 그래프 순회 ─────────────────────────────────────────────
  private node(id: string): PipelineNode {
    const n = this.byId.get(id);
    if (!n) throw new Error(`없는 노드: ${id}`);
    return n;
  }

  private outEdges(id: string): PipelineEdge[] {
    return this.pipeline.edges.filter((e) => e.from === id && !e.onFail);
  }

  private reaches(from: string, to: string): boolean {
    const stack = [from];
    const seen = new Set<string>();
    while (stack.length) {
      const id = stack.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of this.outEdges(id)) stack.push(e.to);
    }
    return false;
  }

  private scope(output: unknown, extra: Record<string, unknown> = {}) {
    return { output, input: this.input, outputs: this.outputs, ...extra };
  }

  private pickNext(
    node: PipelineNode,
    output: unknown,
    skip?: (e: PipelineEdge) => boolean,
  ): string | undefined {
    const outs = this.outEdges(node.id).filter((e) => !skip?.(e));
    const match = outs.find((e) =>
      e.when ? evaluateCondition(e.when, this.scope(output)) : node.type !== 'router',
    );
    if (match) return match.to;
    if (node.type === 'router' && (node as RouterNode).default) return (node as RouterNode).default;
    return undefined;
  }

  /** id부터 실행해 stops의 노드에 닿거나 끝날 때까지 */
  private async runFrom(start: string, value: unknown, stops: Set<string>): Promise<Arrival> {
    let id: string | undefined = start;
    let cur = value;
    while (id !== undefined) {
      if (stops.has(id)) return { at: id, value: cur };
      const node = this.node(id);
      this.checkAbort(node.id);
      switch (node.type) {
        case 'fanout': {
          const r = await this.runFanout(node, cur, stops);
          if (r.join === undefined) return { value: r.value };
          id = r.join;
          cur = r.value;
          // join 노드는 갈래 값을 모아 실행
          const join = this.node(id) as JoinNode;
          const v = await this.passThrough(join, r.value);
          cur = v;
          id = this.pickNext(join, v);
          break;
        }
        case 'loop': {
          const r = await this.runLoop(node, cur, stops);
          cur = r.value;
          id = r.next;
          break;
        }
        case 'role': {
          const v = await this.runRole(node, cur);
          cur = v;
          id = this.pickNext(node, v);
          break;
        }
        case 'gate': {
          const g = await this.runGate(node);
          id = this.pickNext(node, g);
          break;
        }
        case 'subagent': {
          const v = await this.runSubagent(node, cur);
          cur = v;
          id = this.pickNext(node, v);
          break;
        }
        default: {
          const v = await this.passThrough(node, cur);
          cur = v;
          id = this.pickNext(node, v);
        }
      }
    }
    return { value: cur };
  }

  private checkAbort(nodeId: string) {
    if (this.opts.signal?.aborted) throw new Halt('error', nodeId, '중단됨');
  }

  // ── 이벤트 ─────────────────────────────────────────────────
  private emit(rec: LogRecord) {
    this.opts.log?.append(rec);
    this.opts.onEvent?.(rec);
  }

  private nodeStart(node: PipelineNode, visit: number, engineId?: string) {
    this.emit({
      id: this.idGen(),
      ts: this.now().toISOString(),
      sessionId: this.sessionId,
      ...(engineId ? { engineId } : {}),
      type: 'node_start',
      pipeline: this.pipeline.name,
      nodeId: node.id,
      nodeType: node.type,
      visit,
    });
  }

  private record(v: NodeVisit, startedAt: number) {
    this.visits.push(v);
    this.outputs[v.nodeId] = v.output;
    this.emit({
      id: this.idGen(),
      ts: this.now().toISOString(),
      sessionId: this.sessionId,
      ...(v.engineId ? { engineId: v.engineId } : {}),
      type: 'node_end',
      pipeline: this.pipeline.name,
      nodeId: v.nodeId,
      nodeType: v.type,
      visit: v.visit,
      status: v.status,
      durationMs: Date.now() - startedAt,
      ...(v.reason ? { reason: v.reason } : {}),
      ...(v.retries !== undefined ? { retries: v.retries } : {}),
      ...(v.iterations !== undefined ? { iterations: v.iterations } : {}),
    });
  }

  private nextVisit(id: string): number {
    const n = (this.visitCount.get(id) ?? 0) + 1;
    this.visitCount.set(id, n);
    return n;
  }

  private async passThrough(node: PipelineNode, value: unknown): Promise<unknown> {
    const visit = this.nextVisit(node.id);
    const t = Date.now();
    this.nodeStart(node, visit);
    const v: NodeVisit = {
      nodeId: node.id,
      type: node.type,
      visit,
      status: 'completed',
      output: value,
      prompts: [],
      events: [],
    };
    this.record(v, t);
    this.latest.set(node.id, { visit: v });
    return value;
  }

  // ── role ───────────────────────────────────────────────────
  private engineFor(ref: string | undefined): EngineAdapter {
    const e = this.opts.engines;
    const lookup = (id: string) => (typeof e === 'function' ? e(id) : e[id]);
    let id = ref && ref !== 'auto' ? ref : this.opts.defaultEngine;
    if (!id && typeof e !== 'function') id = Object.keys(e)[0];
    const engine = id ? lookup(id) : undefined;
    if (!engine) throw new Error(`엔진을 찾을 수 없습니다: ${id ?? '(auto)'}`);
    return engine;
  }

  private ledgerDir(nodeId: string, visit: number): string {
    return join(this.opts.workspace, '.harness-x', 'sessions', this.sessionId, 'nodes', `${nodeId}.${visit}`);
  }

  /** 노드 프롬프트 (T-042: 입력 값은 값 그대로 주입) */
  protected buildPrompt(node: RoleNode, input: unknown, ledger: ChecklistLedger): string {
    const parts: string[] = [];
    parts.push(`# 역할: ${node.label ?? node.id}`);
    if (node.prompt) parts.push(node.prompt);
    if (node.skills.length) parts.push(`스킬: ${node.skills.join(', ')}`);
    parts.push(`## 입력 값\n\`\`\`json\n${JSON.stringify(input ?? {}, null, 2)}\n\`\`\``);
    const items = ledger.read()?.items ?? [];
    if (items.length)
      parts.push(
        '## 체크리스트 (모든 항목이 done이어야 이 노드가 끝난다)\n' +
          items.map((i) => `- ${i.id}: ${i.title}`).join('\n'),
      );
    return parts.join('\n\n');
  }

  private async turn(
    ctx: NodeRunContext,
    visit: NodeVisit,
    prompt: string,
    resumeId: string | undefined,
  ): Promise<{ events: HarnessEvent[]; engineSessionId?: string }> {
    visit.prompts.push(prompt);
    let lastRun: EngineRun | undefined;
    const base = ctx.engine;
    const engine: EngineAdapter = {
      id: base.id,
      displayName: base.displayName,
      capabilities: base.capabilities,
      run: (o) => (lastRun = base.run(o)),
    };
    const node = ctx.node;
    const mcp = [
      ...(this.opts.harnessMcp
        ? [
            {
              name: 'harness',
              command: this.opts.harnessMcp.command,
              args: [
                ...(this.opts.harnessMcp.args ?? []),
                '--dir',
                ctx.ledgerDir,
                '--session',
                this.sessionId,
              ],
            },
          ]
        : []),
      ...(this.opts.mcpServers?.(ctx) ?? []),
    ];
    const events: HarnessEvent[] = [];
    const stream = runWithStopGuard({
      engine,
      guard: new StopGuard(ctx.ledger),
      stall: new StallDetector(ctx.ledger),
      maxAutoTurns: this.opts.maxAutoTurns ?? 20,
      run: {
        sessionId: this.sessionId,
        prompt,
        cwd: this.opts.workspace,
        permission: PERMISSION[node.permission],
        auth: node.mode,
        env: {
          ...(this.opts.env ?? process.env),
          HARNESS_X_SESSION: this.sessionId,
          HARNESS_X_NODE: node.id,
          HARNESS_X_CHECKLIST_DIR: ctx.ledgerDir,
        },
        ...(mcp.length ? { mcpServers: mcp } : {}),
        ...(resumeId ? { resumeId } : {}),
        ...(this.opts.signal ? { signal: this.opts.signal } : {}),
      },
    });
    for await (const e of stream) {
      events.push(e);
      visit.events.push(e);
      this.emit(e as LogRecord);
    }
    const sid = lastRun?.engineSessionId();
    return { events, ...(sid ? { engineSessionId: sid } : {}) };
  }

  /** 완료 판정: 체크리스트가 있으면 전 항목 done, 없으면 마지막 턴이 completed */
  private completion(ledger: ChecklistLedger, events: HarnessEvent[]): { ok: boolean; reason?: string } {
    const st = checklistStatus(ledger);
    if (st.exists) {
      if (st.complete) return { ok: true };
      return {
        ok: false,
        reason: `체크리스트 미완료 ${st.remaining}/${st.total}: ${st.remainingItems.map((i) => `${i.id}(${i.status})`).join(', ')}`,
      };
    }
    const end = [...events].reverse().find((e) => e.type === 'turn_end');
    if (end && end.type === 'turn_end' && end.reason === 'completed') return { ok: true };
    return {
      ok: false,
      reason: `엔진 턴이 완료되지 않음 (${end?.type === 'turn_end' ? end.reason : '없음'})`,
    };
  }

  private extract(node: RoleNode, events: readonly HarnessEvent[]): unknown {
    if (this.opts.extractOutput) return this.opts.extractOutput(node, events);
    return { text: lastAssistantText(events) };
  }

  private async runRole(node: RoleNode, input: unknown): Promise<unknown> {
    const engine = this.engineFor(node.engine);
    const visitNo = this.nextVisit(node.id);
    const t = Date.now();
    const dir = this.ledgerDir(node.id, visitNo);
    const ledger = new ChecklistLedger({
      dir,
      sessionId: this.sessionId,
      engineId: engine.id,
      ...(this.opts.log ? { log: this.opts.log } : {}),
    });
    const items = this.opts.checklists?.(node, node.checklistTemplate);
    if (items?.length) ledger.create(items);
    this.nodeStart(node, visitNo, engine.id);
    const visit: NodeVisit = {
      nodeId: node.id,
      type: 'role',
      visit: visitNo,
      engineId: engine.id,
      status: 'completed',
      output: undefined,
      ledgerDir: dir,
      prompts: [],
      events: [],
    };
    this.latest.set(node.id, { visit, ledger, engine });
    const ctx: NodeRunContext = {
      pipeline: this.pipeline,
      node,
      sessionId: this.sessionId,
      visit: visitNo,
      engine,
      ledgerDir: dir,
      ledger,
    };
    await this.execRole(ctx, visit, this.buildPrompt(node, input, ledger), t);
    return visit.output;
  }

  /** role 노드 턴 실행 → 완료 판정 → 출력 추출. 실패면 Halt */
  private async execRole(
    ctx: NodeRunContext,
    visit: NodeVisit,
    prompt: string,
    startedAt: number,
  ): Promise<void> {
    const node = ctx.node;
    let res: Awaited<ReturnType<typeof this.turn>>;
    try {
      res = await this.turn(ctx, visit, prompt, undefined);
    } catch (err) {
      visit.status = 'error';
      visit.reason = err instanceof Error ? err.message : String(err);
      this.record(visit, startedAt);
      throw new Halt('error', node.id, visit.reason);
    }
    const done = this.completion(ctx.ledger, res.events);
    if (!done.ok) {
      visit.status = 'incomplete';
      visit.reason = done.reason!;
      this.record(visit, startedAt);
      throw new Halt('incomplete', node.id, done.reason!);
    }
    const out = this.extract(node, visit.events);
    visit.output = out;
    this.record(visit, startedAt);
  }

  // ── gate ───────────────────────────────────────────────────
  /** onFail 대상 ~ gate 사이(일반 엣지 기준) 노드, 위상 순서 */
  private gateSpan(gate: GateNode, target: string): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id) || id === gate.id) return;
      seen.add(id);
      if (!this.reaches(id, gate.id)) return;
      order.push(id);
      for (const e of this.outEdges(id)) visit(e.to);
    };
    visit(target);
    return order;
  }

  private subjects(ids: string[]): GateSubject[] {
    const out: GateSubject[] = [];
    for (const id of ids) {
      const l = this.latest.get(id);
      if (!l?.ledger) continue;
      out.push({ nodeId: id, visit: l.visit, items: l.ledger.read()?.items ?? [], ledger: l.ledger });
    }
    return out;
  }

  private async runGate(gate: GateNode): Promise<unknown> {
    const visitNo = this.nextVisit(gate.id);
    const t = Date.now();
    this.nodeStart(gate, visitNo);
    const target = this.pipeline.edges.find((e) => e.from === gate.id && e.onFail)!.to;
    const span = this.gateSpan(gate, target);
    const verify =
      this.opts.verify ??
      (({ subjects }) => ({
        failed: subjects.flatMap((s) =>
          s.items
            .filter((i) => i.status !== 'done')
            .map((i) => ({ nodeId: s.nodeId, itemId: i.id, reason: `상태 ${i.status}` })),
        ),
      }));
    const visit: NodeVisit = {
      nodeId: gate.id,
      type: 'gate',
      visit: visitNo,
      status: 'completed',
      output: undefined,
      prompts: [],
      events: [],
      retries: 0,
    };
    for (let attempt = 0; ; attempt++) {
      const verdict = await verify({ pipeline: this.pipeline, gate, attempt, subjects: this.subjects(span) });
      const failed = verdict.failed.map((f) => ({ ...f, nodeId: f.nodeId ?? target }));
      visit.output = { passed: failed.length === 0, failed, attempt };
      if (failed.length === 0) break;
      if (attempt >= gate.maxRetries) {
        visit.status = 'failed';
        visit.reason = `gate 실패 (재시도 ${attempt}회 소진): ${failed.map((f) => `${f.nodeId}/${f.itemId}`).join(', ')}`;
        visit.retries = attempt;
        this.record(visit, t);
        throw new Halt('failed', gate.id, visit.reason);
      }
      visit.retries = attempt + 1;
      // 실패 항목이 속한 노드만, 위상 순서대로, 실패 항목만 다시
      for (const id of span) {
        const mine = failed.filter((f) => f.nodeId === id);
        if (mine.length) await this.rerunPartial(id, mine);
      }
    }
    this.record(visit, t);
    this.latest.set(gate.id, { visit });
    return visit.output;
  }

  /** 41.3 부분 재실행: 실패 항목만 todo로 되돌리고(통과 항목은 그대로 done) 그 항목만 지시 */
  private async rerunPartial(nodeId: string, failed: GateFailure[]): Promise<void> {
    const l = this.latest.get(nodeId);
    const node = this.node(nodeId);
    if (!l?.ledger || !l.engine || node.type !== 'role')
      throw new Halt('failed', nodeId, `되돌릴 수 없는 노드: ${nodeId}`);
    const ledger = l.ledger;
    const cur = ledger.get();
    const why = new Map(failed.map((f) => [f.itemId, f.reason]));
    const unknown = failed.filter((f) => !cur.items.some((i) => i.id === f.itemId));
    if (unknown.length)
      throw new Halt('failed', nodeId, `없는 항목: ${unknown.map((f) => f.itemId).join(', ')}`);
    ledger.revise(
      cur.items.map((i) =>
        why.has(i.id)
          ? {
              ...i,
              status: 'todo' as const,
              evidence: [...i.evidence, { kind: 'gate_failed', summary: why.get(i.id)! }],
            }
          : i,
      ),
    );
    const t = Date.now();
    const visit = l.visit;
    this.nodeStart(node, visit.visit, l.engine.id);
    const ctx: NodeRunContext = {
      pipeline: this.pipeline,
      node,
      sessionId: this.sessionId,
      visit: visit.visit,
      engine: l.engine,
      ledgerDir: visit.ledgerDir!,
      ledger,
    };
    // 방문 기록은 같은 것을 이어 쓴다 (visits에는 재실행도 한 줄로 남는다)
    this.visits = this.visits.filter((v) => v !== visit);
    await this.execRole(ctx, visit, this.buildRerunPrompt(node, failed, ledger.get().items), t);
  }

  protected buildRerunPrompt(node: RoleNode, failed: GateFailure[], items: ChecklistItem[]): string {
    const title = new Map(items.map((i) => [i.id, i.title]));
    return [
      `# 역할: ${node.label ?? node.id} — 판정 실패 항목만 다시`,
      '아래 항목만 다시 하세요. 나머지 항목은 이미 통과했으니 건드리지 마세요.',
      failed.map((f) => `- ${f.itemId}: ${title.get(f.itemId) ?? ''} — 실패 사유: ${f.reason}`).join('\n'),
    ].join('\n\n');
  }

  // ── fanout / join ─────────────────────────────────────────
  /** 모든 갈래에서 닿는 가장 가까운 노드 (BFS 순서) */
  private findJoin(starts: string[]): string | undefined {
    const queue = [starts[0]!];
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (starts.every((s) => this.reaches(s, id)) && this.node(id).type === 'join') return id;
      for (const e of this.outEdges(id)) queue.push(e.to);
    }
    return undefined;
  }

  private async runFanout(
    node: FanoutNode,
    value: unknown,
    stops: Set<string>,
  ): Promise<{ join?: string; value: unknown }> {
    await this.passThrough(node, value);
    const branches = this.outEdges(node.id)
      .filter((e) => !e.when || evaluateCondition(e.when, this.scope(value)))
      .map((e) => e.to);
    const join = this.findJoin(branches);
    const inner = new Set(stops);
    if (join) inner.add(join);
    const limit = Math.min(node.maxConcurrency, MAX_FANOUT_CONCURRENCY);
    const results: unknown[] = new Array(branches.length);
    let next = 0;
    let halt: Halt | undefined;
    const worker = async () => {
      while (next < branches.length && !halt) {
        const k = next++;
        try {
          results[k] = (await this.runFrom(branches[k]!, value, inner)).value;
        } catch (err) {
          if (err instanceof Halt) halt ??= err;
          else throw err;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, branches.length) }, worker));
    if (halt) throw halt;
    const merged: Record<string, unknown> = {};
    for (const r of results) if (r && typeof r === 'object' && !Array.isArray(r)) Object.assign(merged, r);
    merged.branches = Object.fromEntries(branches.map((b, k) => [b, results[k]]));
    return { ...(join ? { join } : {}), value: merged };
  }

  // ── loop ───────────────────────────────────────────────────
  private async runLoop(
    node: LoopNode,
    value: unknown,
    stops: Set<string>,
  ): Promise<{ next?: string; value: unknown }> {
    const visitNo = this.nextVisit(node.id);
    const t = Date.now();
    this.nodeStart(node, visitNo);
    const body = this.outEdges(node.id).filter((e) => this.reaches(e.to, node.id));
    const inner = new Set(stops);
    inner.add(node.id);
    let cur = value;
    let prevHash: string | undefined;
    let same = 0;
    let status: NodeStatus = 'max_iterations';
    let reason: string | undefined;
    let iterations = 0;
    for (let i = 1; i <= node.maxIterations; i++) {
      iterations = i;
      const start = body.find((e) => !e.when || evaluateCondition(e.when, this.scope(cur, { iteration: i })));
      if (!start) {
        status = 'completed';
        break;
      }
      const a = await this.runFrom(start.to, cur, inner);
      cur = a.value;
      if (node.until && evaluateCondition(node.until, this.scope(cur, { iteration: i }))) {
        status = 'completed';
        reason = `until 참 (${node.until})`;
        break;
      }
      const h = stableHash(cur);
      same = h === prevHash ? same + 1 : 0;
      prevHash = h;
      if (same >= node.stallLimit) {
        status = 'stalled';
        reason = `정체: 출력 변화 없이 ${same + 1}회 반복`;
        break;
      }
    }
    if (status === 'max_iterations') reason = `최대 반복 ${node.maxIterations}회 도달`;
    const visit: NodeVisit = {
      nodeId: node.id,
      type: 'loop',
      visit: visitNo,
      status,
      output: cur,
      prompts: [],
      events: [],
      iterations,
      ...(reason ? { reason } : {}),
    };
    this.record(visit, t);
    if (status === 'stalled') throw new Halt('stalled', node.id, reason!);
    const exit = this.pickNext(node, cur, (e) => body.includes(e));
    return { ...(exit ? { next: exit } : {}), value: cur };
  }

  // ── subagent ───────────────────────────────────────────────
  private async runSubagent(node: SubagentNode, value: unknown): Promise<unknown> {
    const visitNo = this.nextVisit(node.id);
    const t = Date.now();
    this.nodeStart(node, visitNo);
    const pipeline = this.opts.resolveAgent?.(node.agent.replace(/^\//, ''));
    const visit: NodeVisit = {
      nodeId: node.id,
      type: 'subagent',
      visit: visitNo,
      status: 'completed',
      output: undefined,
      prompts: [],
      events: [],
    };
    if (!pipeline) {
      visit.status = 'error';
      visit.reason = `에이전트를 찾을 수 없습니다: ${node.agent}`;
      this.record(visit, t);
      throw new Halt('error', node.id, visit.reason);
    }
    const child = new PipelineRunner({
      ...this.opts,
      sessionId: `${this.sessionId}.${node.id}.${visitNo}`,
      ...(node.engine && node.engine !== 'auto' ? { defaultEngine: node.engine } : {}),
    });
    const r = await child.run(pipeline, value);
    visit.output = r.result;
    if (r.status !== 'completed') {
      visit.status = r.status === 'stalled' ? 'stalled' : r.status === 'incomplete' ? 'incomplete' : 'failed';
      visit.reason = `하위 에이전트 ${node.agent}: ${r.reason ?? r.status}`;
      this.record(visit, t);
      throw new Halt(r.status, node.id, visit.reason);
    }
    this.record(visit, t);
    return r.result;
  }
}

/** 편의 함수: 파이프라인 1회 실행 */
export function runPipeline(
  pipeline: Pipeline,
  input: unknown,
  opts: PipelineRunnerOptions,
): Promise<PipelineRunResult> {
  return new PipelineRunner(opts).run(pipeline, input);
}
