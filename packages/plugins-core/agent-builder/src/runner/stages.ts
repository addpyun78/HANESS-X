import { join } from 'node:path';
import { checkPlainKorean } from '@harness-x/approvals';
import {
  ACTIVE_STAGE_STATUSES,
  advanceStage,
  allStages,
  applyGateFailure,
  attachAgentTree,
  buildSkeleton,
  buildStageSlice,
  chooseRoute,
  completeStage,
  currentStage,
  decideLock,
  defaultStageSummary,
  endLoop,
  enterStage,
  getStage,
  isStageSettled,
  recheckStage,
  setStageStatus,
  startIteration,
  StageTreeStore,
  syncStageItems,
  withSlice,
  type Acceptance,
  type AgentRef,
  type ConfirmCard,
  type ExitContext,
  type ProposeFn,
  type ReviewEntry,
  type RunMode,
  type Stage,
  type StageTree,
  type TemplateFn,
} from '@harness-x/checklist-ledger';
import type { Pipeline, PipelineNode } from '@harness-x/protocol';
import { validateOutput } from '../contract.js';
import type { RunnerStageHooks } from './types.js';

/**
 * 실행기 ↔ 단계 트리 연결 (T-101 4번)
 * 실행이 시작되는 순간(start) 그 에이전트 파이프라인으로 뼈대를 만들고, 실행기가 노드를 지날 때마다
 * 단계 상태·하위 항목·handoff를 맞춘다. 단계는 오직 파이프라인에 적힌 것만 — AI가 단계를 나누지 않는다.
 */

export interface StageTrackerOptions {
  sessionId: string;
  /** 실행할 에이전트 (없으면 단계 1개) */
  agent?: AgentRef | null;
  /** 노드 checklistTemplate → 틀 항목 */
  templates?: TemplateFn;
  /** 실행 모드 (3번 실행 모드가 정해 넘긴다, 기본 normal) */
  mode?: RunMode;
  /** 단계 진입 시 노드 AI의 세부 항목 제안 (4B.2) */
  propose?: ProposeFn;
  /** 승인 카드에 대한 사람 답 (기본: 승인 카드만 남기고 그대로 진행) */
  approve?: (stage: Stage, reason: string) => boolean;
  /** 단계 요약 (기본: 출력의 summary 문자열 → 없으면 기본 문구). 쉬운 말 검사를 못 넘으면 기본 문구 */
  summarize?: (stage: Stage, output: unknown) => string | undefined;
  /** 노드 acceptance 실행 */
  checkAcceptance?: (a: Acceptance, stage: Stage) => boolean;
  /** 하위 에이전트 파이프라인 찾기 */
  resolveAgent?: (name: string) => Pipeline | undefined;
  /** 저장소 (있으면 바뀔 때마다 stages.json에 쓴다) */
  store?: StageTreeStore;
  now?: () => Date;
}

/** H.6 쉬운 말 검사 */
export const plainLine = (s: string) => checkPlainKorean(s).ok;

export class StageTracker {
  tree!: StageTree;
  /** 승인 카드 (일반 모드 첫 단계·범위 밖·린터 실패, 검사 3회 실패) */
  readonly cards: (ConfirmCard | { kind: 'stage_lock'; stageId: string; reason: string })[] = [];
  /** 오토 모드 "돌아오면 확인할 것" */
  readonly review: ReviewEntry[] = [];
  /** 단계 진입 때 린터에 걸린 제안 */
  readonly lintRejected: { stageId: string; itemId: string; rule: string }[] = [];
  private started = false;
  private locks = 0;

  constructor(readonly opts: StageTrackerOptions) {}

  get mode(): RunMode {
    return this.opts.mode ?? 'normal';
  }

  private set(t: StageTree) {
    this.tree = this.opts.store ? this.opts.store.write(t) : t;
  }

  /** 실행 시작 순간에만 부른다 — 그 전에는 트리가 없다 */
  start(): StageTree {
    // 이어하기: 같은 에이전트로 이미 만든 트리가 있으면 그대로 이어 쓴다
    const prev = this.opts.store?.read();
    if (prev && prev.agent === (this.opts.agent?.name ?? null)) {
      this.tree = prev;
      this.started = true;
      this.locks = 1;
      return this.tree;
    }
    if (this.opts.store)
      this.tree = this.opts.store.start({ agent: this.opts.agent ?? null, ...this.tmpl() });
    else
      this.tree = buildSkeleton({
        sessionId: this.opts.sessionId,
        agent: this.opts.agent ?? null,
        ...this.tmpl(),
        ...(this.opts.now ? { now: this.opts.now } : {}),
      });
    this.started = true;
    return this.tree;
  }

  private tmpl() {
    return this.opts.templates ? { templates: this.opts.templates } : {};
  }

  /** 실행기에 넘길 알림 (prefix: 하위 에이전트 단계 id 앞부분) */
  hooks(prefix = ''): RunnerStageHooks {
    return {
      nodeStart: (i) => this.nodeStart(i.node, prefix, i.engineId, i.rerun),
      nodeEnd: (i) => this.nodeEnd(i.node, prefix, i.status, i.output, i.items, i.reason, i.interrupted),
      gateFailed: (i) =>
        this.gateFailed(
          i.gate,
          prefix,
          i.failed.map((f) => ({ nodeId: f.nodeId, itemId: f.itemId, reason: f.reason })),
        ),
      loopIteration: (i) => this.loopIteration(i.loop, prefix, i.iteration),
      loopEnd: (i) => this.loopEnd(i.loop, prefix, i.reason),
      routeChosen: (i) => this.set(chooseRoute(this.tree, i.router.id, i.to, { prefix, ...this.nowOpt() })),
      subagent: (i) => this.subagent(i.node, prefix, i.agent, i.pipeline),
      prompt: (i) => this.prompt(i.node, prefix, i.prompt),
      nodeItems: (i) => this.nodeItems(i.node, prefix, i.items),
    };
  }

  private nowOpt() {
    return this.opts.now ? { now: this.opts.now } : {};
  }

  /** 노드에 맞는 단계 (진행 중인 회차·같은 하위 트리 안) */
  stageOf(nodeId: string, prefix = ''): Stage | undefined {
    const flat = allStages(this.tree);
    const parentOf = (s: Stage) => flat.find((p) => p.children.includes(s));
    /** 이 단계를 실행하는 에이전트의 prefix (가장 가까운 하위 에이전트 단계 id + '.') */
    const ownerPrefix = (s: Stage): string => {
      for (let p = parentOf(s); p; p = parentOf(p)) if (p.kind === 'subagent') return `${p.stageId}.`;
      return '';
    };
    const cands = flat.filter(
      (s) => s.nodeId === nodeId && s.kind !== 'iteration' && ownerPrefix(s) === prefix,
    );
    const inRunningIteration = (s: Stage) => {
      const parent = parentOf(s);
      return !parent || parent.kind !== 'iteration' || !isStageSettled(parent.status);
    };
    return (
      cands.find((s) => ACTIVE_STAGE_STATUSES.includes(s.status) && inRunningIteration(s)) ??
      cands.find((s) => s.status === 'expected' && inRunningIteration(s)) ??
      cands.find((s) => s.status === 'blocked') ??
      cands.filter((s) => s.status === 'done').at(-1)
    );
  }

  private async nodeStart(
    node: PipelineNode,
    prefix: string,
    engineId?: string,
    rerun?: boolean,
  ): Promise<void | { stop: string }> {
    if (!this.started) return;
    const s = this.stageOf(node.id, prefix);
    if (!s) return;
    let t = this.tree;
    if (engineId) {
      t = structuredClone(t);
      getStage(t, s.stageId).engineId = engineId;
    }
    if (rerun || s.status === 'reopened') {
      if (s.status === 'reopened') t = setStageStatus(t, s.stageId, 'running', this.nowOpt());
      this.set(t);
      return;
    }
    if (s.status !== 'expected') {
      this.set(t);
      return;
    }
    // 4B.2 단계 진입: 앞 단계 handoff → 제안 → 린터 → 틀과 합치기
    const entered = await enterStage(t, s.stageId, {
      ...(this.opts.propose ? { propose: this.opts.propose } : {}),
      ...this.nowOpt(),
    });
    for (const v of entered.violations)
      this.lintRejected.push({ stageId: s.stageId, itemId: v.itemId, rule: v.rule });
    t = entered.tree;
    // 4B.3 확정
    const d = decideLock({
      mode: this.mode,
      first: this.locks === 0,
      lintOk: entered.violations.length === 0,
      inScope: true,
    });
    this.locks++;
    if (d.action === 'stop') {
      this.set(t);
      this.cards.push({ kind: 'stage_lock', stageId: s.stageId, reason: d.reason });
      return { stop: d.reason };
    }
    if (d.action === 'approve') {
      this.cards.push({ kind: 'stage_lock', stageId: s.stageId, reason: d.reason });
      if (this.opts.approve && !this.opts.approve(getStage(t, s.stageId), d.reason)) {
        this.set(t);
        return { stop: '단계 확정을 승인받지 못했어요.' };
      }
    }
    t = advanceStage(t, s.stageId, 'running', this.opts.now);
    this.set(t);
  }

  private exitCtx(): ExitContext {
    return {
      validateOutput: (v, schema) => {
        const r = validateOutput(v, schema);
        return { ok: r.ok, missing: [...r.missing, ...r.invalid.map((x) => x.path)] };
      },
      ...(this.opts.checkAcceptance ? { checkAcceptance: this.opts.checkAcceptance } : {}),
    };
  }

  private summaryOf(s: Stage, output: unknown): string {
    const own = this.opts.summarize?.(s, output);
    if (own !== undefined) return own;
    const o = output && typeof output === 'object' ? (output as Record<string, unknown>) : {};
    return typeof o.summary === 'string' ? o.summary : '';
  }

  private nodeEnd(
    node: PipelineNode,
    prefix: string,
    status: string,
    output: unknown,
    items?: Stage['items'],
    reason?: string,
    interrupted?: boolean,
  ): void {
    if (!this.started) return;
    const s = this.stageOf(node.id, prefix);
    if (!s || s.kind === 'loop') return;
    let t = this.tree;
    if (items) t = this.mergeItems(t, s, items, status === 'completed');
    else if (status === 'completed') {
      t = structuredClone(t);
      for (const i of getStage(t, s.stageId).items) i.status = 'done';
    }
    if (status !== 'completed') {
      const cur = getStage(t, s.stageId);
      // 정지로 끝났으면 막힘이 아니다 — 이어하기에서 그 단계부터 계속
      if (cur.status !== 'blocked' && node.type !== 'gate' && !interrupted)
        t = setStageStatus(t, s.stageId, 'blocked', { reason: reason ?? status, ...this.nowOpt() });
      this.set(t);
      return;
    }
    if (node.type === 'gate') {
      // 검사 통과: 다시 확인이 필요한 단계는 출구 조건만 재검사
      for (const r of allStages(t).filter(
        (x) => x.status === 'needs-recheck' && x.stageId.startsWith(prefix),
      ))
        t = recheckStage(t, r.stageId, { ...this.exitCtx(), ...this.nowOpt() }).tree;
    }
    const cur = getStage(t, s.stageId);
    if (cur.status === 'expected' || cur.status === 'planning' || cur.status === 'locked')
      t = advanceStage(t, s.stageId, 'running', this.opts.now);
    const r = completeStage(t, s.stageId, {
      ...this.exitCtx(),
      handoff: { output, summary: this.summaryOf(cur, output) },
      ...this.nowOpt(),
    });
    t = r.tree;
    if (r.done) {
      // 쉬운 말 검사 (H.6)
      const h = getStage(t, s.stageId).handoff;
      if (h) {
        const lines = h.summary.split('\n');
        if (!lines.every(plainLine)) {
          t = structuredClone(t);
          const x = getStage(t, s.stageId);
          const fallback = defaultStageSummary(x);
          x.handoff = { ...h, summary: fallback };
          x.summary = fallback;
        }
      }
    }
    this.set(t);
  }

  /** 실행기 원장 항목을 단계에 맞춘다. 트리에만 있는 재작업 항목은 노드가 끝나면 함께 끝낸다 */
  private mergeItems(t: StageTree, s: Stage, items: Stage['items'], done: boolean): StageTree {
    const extra = getStage(t, s.stageId).items.filter((i) => !items.some((x) => x.id === i.id));
    const next = syncStageItems(
      t,
      s.stageId,
      [...items, ...extra.map((i) => (done ? { ...i, status: 'done' as const } : i))],
      this.opts.now,
    );
    const meta = getStage(next, s.stageId).itemMeta;
    for (const i of extra) meta[i.id] = s.itemMeta[i.id] ?? { origin: 'rework' };
    for (const i of items) if (s.itemMeta[i.id]) meta[i.id] = s.itemMeta[i.id]!;
    return next;
  }

  private nodeItems(node: PipelineNode, prefix: string, items: Stage['items']) {
    if (!this.started) return;
    const s = this.stageOf(node.id, prefix);
    if (!s) return;
    this.set(this.mergeItems(this.tree, s, items, false));
  }

  private gateFailed(
    gate: PipelineNode,
    prefix: string,
    failed: { nodeId: string; itemId: string; reason: string }[],
  ) {
    const g = this.stageOf(gate.id, prefix);
    if (!g) return;
    const findings = failed.map((f) => {
      const target = this.stageOf(f.nodeId, prefix);
      return { stageId: target?.stageId ?? g.stageId, itemId: f.itemId, reason: f.reason };
    });
    const r = applyGateFailure(this.tree, g.stageId, findings, { mode: this.mode, ...this.nowOpt() });
    if (r.blocked?.card) this.cards.push(r.blocked.card);
    if (r.blocked?.review) this.review.push(r.blocked.review);
    this.set(r.tree);
  }

  private loopIteration(loop: PipelineNode, prefix: string, n: number) {
    const s = this.stageOf(loop.id, prefix);
    if (!s) return;
    let t = this.tree;
    // 앞 회차 마무리
    const prev = getStage(t, s.stageId).children.find((c) => c.iteration === n - 1);
    if (prev && !isStageSettled(prev.status) && prev.children.every((c) => isStageSettled(c.status))) {
      t = structuredClone(t);
      getStage(t, prev.stageId).status = 'done';
    }
    this.set(startIteration(t, s.stageId, n, this.pipelineFor(prefix), { ...this.tmpl(), ...this.nowOpt() }));
  }

  private loopEnd(loop: PipelineNode, prefix: string, reason?: string) {
    const s = this.stageOf(loop.id, prefix);
    if (!s) return;
    let t = endLoop(this.tree, s.stageId, {
      reason: reason ? `반복을 마쳐서 건너뛰었어요 (${reason})` : '반복을 마쳐서 건너뛰었어요.',
      ...this.nowOpt(),
    });
    if (getStage(t, s.stageId).status === 'expected')
      t = advanceStage(t, s.stageId, 'running', this.opts.now);
    t = completeStage(t, s.stageId, { ...this.exitCtx(), ...this.nowOpt() }).tree;
    this.set(t);
  }

  /** prefix(하위 에이전트) → 그 파이프라인 */
  private readonly pipelines = new Map<string, Pipeline>();
  private pipelineFor(prefix: string): Pipeline {
    const p = prefix ? this.pipelines.get(prefix) : this.opts.agent?.pipeline;
    if (!p) throw new Error(`파이프라인을 모릅니다: ${prefix || '(최상위)'}`);
    return p;
  }

  private subagent(
    node: PipelineNode,
    prefix: string,
    agent: string,
    pipeline: Pipeline,
  ): RunnerStageHooks | undefined {
    const s = this.stageOf(node.id, prefix);
    if (!s) return undefined;
    this.set(
      attachAgentTree(this.tree, s.stageId, { name: agent, pipeline }, { ...this.tmpl(), ...this.nowOpt() }),
    );
    const child = `${s.stageId}.`;
    this.pipelines.set(child, pipeline);
    return this.hooks(child);
  }

  /** 실행 중 `/`로 다른 에이전트를 부른 순간: 현재 단계 아래에 그 에이전트 트리 */
  callAgent(name: string, pipeline: Pipeline): RunnerStageHooks {
    const cur = currentStage(this.tree);
    if (!cur) throw new Error('진행 중인 단계가 없어요');
    const t = attachAgentTree(
      this.tree,
      cur.stageId,
      { name, pipeline },
      { ...this.tmpl(), ...this.nowOpt() },
    );
    this.set(t);
    const host = getStage(t, cur.stageId).children.at(-1)!;
    const child = `${host.stageId}.`;
    this.pipelines.set(child, pipeline);
    return this.hooks(child);
  }

  /** 4C.2·4C.3 노드 프롬프트 앞에 그 단계 슬라이스 (엔진과 상관없이 같은 형식) */
  private prompt(node: PipelineNode, prefix: string, prompt: string): string {
    if (!this.started) return prompt;
    const s = this.stageOf(node.id, prefix);
    if (!s) return prompt;
    return withSlice(prompt, buildStageSlice(this.tree, { stageId: s.stageId }));
  }
}

/** 편의: 실행기 옵션에 바로 넣는 단계 추적기 */
export function trackStages(opts: StageTrackerOptions): { tracker: StageTracker; stages: RunnerStageHooks } {
  const tracker = new StageTracker(opts);
  tracker.start();
  return { tracker, stages: tracker.hooks() };
}

/**
 * 커널 디스패치용: 실행이 시작되는 순간 <workspace>/.harness-x/sessions/<id>/stages.json에 단계 뼈대를 만들고
 * 실행기 옵션 { stages }를 돌려준다 (cli.ts가 PipelineRunner 옵션에 펼쳐 넣는다).
 */
export function stageRunnerOptions(o: {
  workspace: string;
  sessionId: string;
  agent: AgentRef;
  mode?: RunMode;
}): { stages: RunnerStageHooks } {
  const store = new StageTreeStore({
    dir: join(o.workspace, '.harness-x', 'sessions', o.sessionId),
    sessionId: o.sessionId,
  });
  const tracker = new StageTracker({
    sessionId: o.sessionId,
    agent: o.agent,
    store,
    ...(o.mode ? { mode: o.mode } : {}),
  });
  tracker.start();
  return { stages: tracker.hooks() };
}
