import { lintChecklist, type LintViolation } from '../lint.js';
import {
  ChecklistItemSchema,
  type Acceptance,
  type ChecklistItem,
  type ChecklistItemInput,
} from '../schema.js';
import type { Handoff, Stage, StageTree } from './schema.js';
import { isStageSettled } from './state.js';
import { allStages, canStartStage, cloneTree, getStage, setStageStatus, advanceStage } from './tree.js';

/**
 * 단계 진행 규칙 (T-101 4A.5·4B.2·4B.3·4C.1·4D)
 *  - 단계 완료 = 하위 항목 전부 done + 출구 조건(출력 스키마 검증 + 노드 acceptance) 통과
 *  - 뼈대는 실행이 시작될 때, 내용은 단계에 들어갈 때 (앞 단계 handoff를 보고 노드 AI가 세부 항목 제안)
 *  - 검사 단계가 실패를 찾으면 지적받은 단계에 재작업 항목을 붙여 그 단계만 다시 열고, 뒤 단계는 다시 확인 필요
 */

const now0 = () => new Date();

// ── 4A.5 출구 조건 ────────────────────────────────────────────
export interface ExitCheckResult {
  ok: boolean;
  reason?: string;
}

export interface ExitContext {
  /** 단계 출력값 (handoff로 넘길 값) */
  output?: unknown;
  /** 출력 스키마 검증 (T-042 validateOutput 주입). 없으면 required 키만 본다 */
  validateOutput?: (value: unknown, schema: Record<string, unknown>) => { ok: boolean; missing?: string[] };
  /** 노드 acceptance 실행 (판정기 주입). acceptance가 있는데 이게 없으면 통과로 보지 않는다 */
  checkAcceptance?: (a: Acceptance, stage: Stage) => boolean;
}

function requiredKeysCheck(value: unknown, schema: Record<string, unknown>) {
  const req = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const missing = req.filter((k) => obj[k] === undefined);
  return { ok: missing.length === 0, missing };
}

/** 출구 조건만 검사 (하위 항목은 보지 않음 — 4D.3 재검사에서도 쓴다) */
export function checkExitCriteria(s: Stage, ctx: ExitContext = {}): ExitCheckResult {
  const schema = s.exitCriteria.outputSchema;
  if (schema) {
    const value = ctx.output !== undefined ? ctx.output : s.handoff?.output;
    const r = (ctx.validateOutput ?? requiredKeysCheck)(value, schema);
    if (!r.ok)
      return {
        ok: false,
        reason: `출력값이 약속한 모양이 아니에요${r.missing?.length ? ` (빠짐: ${r.missing.join(', ')})` : ''}`,
      };
  }
  for (const a of s.exitCriteria.acceptance) {
    if (!ctx.checkAcceptance) return { ok: false, reason: '단계 완료 조건을 검사할 방법이 없어요' };
    if (!ctx.checkAcceptance(a, s))
      return { ok: false, reason: `단계 완료 조건을 통과하지 못했어요 (${a.type})` };
  }
  return { ok: true };
}

/** 단계 완료 판정: 하위 전부 done(+ 자식 단계 끝남) + 출구 조건 */
export function evaluateStage(s: Stage, ctx: ExitContext = {}): ExitCheckResult {
  const open = s.items.filter((i) => i.status !== 'done');
  if (open.length)
    return { ok: false, reason: `남은 항목 ${open.length}개: ${open.map((i) => i.id).join(', ')}` };
  const kids = s.children.filter((c) => !isStageSettled(c.status));
  if (kids.length) return { ok: false, reason: `남은 하위 단계: ${kids.map((c) => c.stageId).join(', ')}` };
  return checkExitCriteria(s, ctx);
}

/**
 * 단계 마치기 시도: running/verifying → verifying → (통과) done / (실패) running.
 * handoff를 주면 통과할 때 함께 저장한다 (4C.1).
 */
export function completeStage(
  t: StageTree,
  stageId: string,
  ctx: ExitContext & { handoff?: { output: unknown; summary: string }; now?: () => Date } = {},
): { tree: StageTree; done: boolean; reason?: string } {
  const now = ctx.now ?? now0;
  let next = t;
  const s0 = getStage(next, stageId);
  if (s0.status === 'done') return { tree: t, done: true };
  if (s0.status !== 'verifying')
    next = setStageStatus(next, stageId, s0.status === 'needs-recheck' ? 'verifying' : 'verifying', { now });
  const s = getStage(next, stageId);
  const exitCtx: ExitContext = { ...ctx, ...(ctx.handoff ? { output: ctx.handoff.output } : {}) };
  const r = s0.status === 'needs-recheck' ? checkExitCriteria(s, exitCtx) : evaluateStage(s, exitCtx);
  if (!r.ok) {
    next = setStageStatus(next, stageId, s0.status === 'needs-recheck' ? 'reopened' : 'running', {
      reason: r.reason!,
      now,
    });
    return { tree: next, done: false, reason: r.reason! };
  }
  next = setStageStatus(next, stageId, 'done', { now });
  if (ctx.handoff) next = saveHandoff(next, stageId, ctx.handoff, { now });
  const done = getStage(next, stageId);
  delete done.reason;
  return { tree: next, done: true };
}

// ── 4C.1 handoff ─────────────────────────────────────────────
export const MAX_SUMMARY_LINES = 3;

/** 쉬운 말 요약 기본값 (AI 요약이 검사를 못 넘으면 이걸 쓴다) */
export function defaultStageSummary(s: Pick<Stage, 'title' | 'items'>): string {
  const n = s.items.filter((i) => i.status === 'done').length;
  return n ? `할 일 ${n}개를 모두 마쳤어요.` : '이 단계를 마쳤어요.';
}

/** 요약 다듬기: 3줄 이내 + 쉬운 말 검사(H.6 주입) 통과, 아니면 기본 요약 */
export function normalizeSummary(
  summary: string | undefined,
  s: Pick<Stage, 'title' | 'items'>,
  isPlain?: (text: string) => boolean,
): string {
  const lines = (summary ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length || lines.length > MAX_SUMMARY_LINES) return defaultStageSummary(s);
  const text = lines.join('\n');
  if (isPlain && !lines.every((l) => isPlain(l))) return defaultStageSummary(s);
  return text;
}

export function saveHandoff(
  t: StageTree,
  stageId: string,
  h: { output: unknown; summary: string },
  o: { isPlain?: (text: string) => boolean; now?: () => Date } = {},
): StageTree {
  const next = cloneTree(t);
  const s = getStage(next, stageId);
  const summary = normalizeSummary(h.summary, s, o.isPlain);
  const handoff: Handoff = { output: h.output, summary, at: (o.now ?? now0)().toISOString() };
  s.handoff = handoff;
  s.summary = summary;
  next.updatedAt = handoff.at;
  return next;
}

/** 단계에 들어갈 때 받을 앞 단계 handoff (같은 묶음 안에서 바로 앞, 없으면 위로) */
export function previousHandoff(t: Pick<StageTree, 'stages'>, stageId: string): Handoff | undefined {
  const flat = allStages(t);
  const k = flat.findIndex((s) => s.stageId === stageId);
  for (let j = k - 1; j >= 0; j--) {
    const s = flat[j]!;
    if (s.status === 'done' && s.handoff) return s.handoff;
  }
  return undefined;
}

// ── 4B.2 단계 진입: 세부 항목 제안 → 원자성 린터 → 틀 항목과 합치기 ──
export type ProposeFn = (input: {
  stage: Stage;
  handoff: Handoff | undefined;
}) => ChecklistItemInput[] | Promise<ChecklistItemInput[]>;

export interface EnterResult {
  tree: StageTree;
  /** 린터에 걸려 빠진 제안 */
  violations: LintViolation[];
  /** 틀 항목과 같아 합친 제안 id */
  merged: string[];
  added: string[];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export class StageNotReadyError extends Error {
  readonly code = 'STAGE_NOT_READY';
  constructor(
    readonly stageId: string,
    readonly waiting: string[],
  ) {
    super(`단계 ${stageId}: 먼저 끝나야 하는 단계가 있어요 (${waiting.join(', ')})`);
    this.name = 'StageNotReadyError';
  }
}

/** 단계에 들어간다: expected → planning, 노드 AI 제안을 린터로 거르고 틀 항목과 합친다 */
export async function enterStage(
  t: StageTree,
  stageId: string,
  o: { propose?: ProposeFn; handoff?: Handoff; now?: () => Date } = {},
): Promise<EnterResult> {
  const ready = canStartStage(t, stageId);
  if (!ready.ok) throw new StageNotReadyError(stageId, ready.waiting);
  const next =
    getStage(t, stageId).status === 'expected'
      ? setStageStatus(t, stageId, 'planning', { now: o.now })
      : cloneTree(t);
  const s = getStage(next, stageId);
  const handoff = o.handoff ?? previousHandoff(next, stageId);
  const raw = o.propose ? await o.propose({ stage: s, handoff }) : [];
  const lint = lintChecklist(raw.map((r) => ({ ...r, deps: r.deps ?? [] })) as never);
  const bad = new Set(lint.violations.map((v) => v.itemId));
  const merged: string[] = [];
  const added: string[] = [];
  for (const r of raw) {
    if (bad.has(r.id)) continue;
    const dup = s.items.find((i) => i.id === r.id || norm(i.title) === norm(r.title));
    if (dup) {
      merged.push(r.id);
      continue;
    }
    const parsed = ChecklistItemSchema.safeParse(r);
    if (!parsed.success) continue;
    s.items.push(parsed.data);
    s.itemMeta[parsed.data.id] = { origin: 'proposed' };
    added.push(parsed.data.id);
  }
  next.updatedAt = (o.now ?? now0)().toISOString();
  return { tree: next, violations: lint.violations, merged, added };
}

// ── 4B.3 단계 확정(Lock) ──────────────────────────────────────
export type RunMode = 'plan' | 'normal' | 'auto';
export type LockDecision =
  /** 자동 확정 */
  | { action: 'auto' }
  /** 승인 카드 */
  | { action: 'approve'; reason: string }
  /** 계획 모드: 뼈대 + 1단계까지 만들고 멈춤 */
  | { action: 'stop'; reason: string };

export interface LockInput {
  mode: RunMode;
  /** 실행의 첫 단계인가 (뼈대 + 1단계 승인) */
  first: boolean;
  /** 원자성 린터 통과 */
  lintOk: boolean;
  /** 제안 항목이 그 단계 산출물 범위 안 */
  inScope: boolean;
}

export const LOCK_REASONS = {
  first: '처음 시작할 때 단계 목록과 첫 단계 할 일을 한 번 확인해 주세요.',
  lint: '이번 단계 할 일 중 너무 큰 항목이 있어요. 확인해 주세요.',
  scope: '이번 단계 할 일이 이 단계가 맡은 파일 밖을 건드려요. 확인해 주세요.',
  plan: '계획 모드라서 첫 단계 계획까지만 만들고 멈췄어요.',
} as const;

/** 모드별 단계 확정 규칙 (모드는 인자로 받는다 — 실행 모드 3번과 독립) */
export function decideLock(i: LockInput): LockDecision {
  if (i.mode === 'auto') return { action: 'auto' };
  if (i.mode === 'plan') return { action: 'stop', reason: LOCK_REASONS.plan };
  if (i.first) return { action: 'approve', reason: LOCK_REASONS.first };
  if (!i.lintOk) return { action: 'approve', reason: LOCK_REASONS.lint };
  if (!i.inScope) return { action: 'approve', reason: LOCK_REASONS.scope };
  return { action: 'auto' };
}

/** 확정: planning → locked (승인 뒤 또는 자동) */
export function lockStage(t: StageTree, stageId: string, now?: () => Date): StageTree {
  return advanceStage(t, stageId, 'locked', now);
}

// ── 4D 검사 실패와 되돌림 ─────────────────────────────────────
export const MAX_GATE_FAILURES = 3;

export interface GateFinding {
  /** 지적 대상 단계 */
  stageId: string;
  /** 관련 항목 (있으면 그 항목만 다시) */
  itemId?: string;
  /** 지적 원문 */
  reason: string;
  /** 지적 원문 링크 */
  link?: string;
}

export interface ConfirmCard {
  kind: 'stage_blocked';
  stageId: string;
  title: string;
  body: string;
  options: string[];
}

export interface GateFailureResult {
  tree: StageTree;
  reopened: string[];
  recheck: string[];
  /** 추가된 재작업 항목 (단계 id → 항목 id) */
  rework: { stageId: string; itemId: string }[];
  /** 3회 실패: 일반·계획 모드면 확인 카드, 오토 모드면 "돌아오면 확인할 것" 목록 줄 */
  blocked?: { card?: ConfirmCard; review?: { stageId: string; text: string } };
}

export function blockedCard(gate: Pick<Stage, 'stageId' | 'title'>, reason: string): ConfirmCard {
  return {
    kind: 'stage_blocked',
    stageId: gate.stageId,
    title: `${gate.title} 검사를 ${MAX_GATE_FAILURES}번 통과하지 못했어요`,
    body: `같은 문제가 계속 나와서 멈췄어요. 마지막 지적: ${reason}`,
    options: ['직접 고친 뒤 다시 하기', '이 검사 건너뛰기', '여기서 멈추기'],
  };
}

function reworkItem(s: Stage, n: number, f: GateFinding): ChecklistItem {
  const base = f.itemId ? s.items.find((i) => i.id === f.itemId) : undefined;
  return ChecklistItemSchema.parse({
    id: `${s.nodeId ?? s.stageId.replace(/\./g, '-')}-r${n}`,
    title: `다시 하기: ${f.reason}`,
    artifactId: base?.artifactId ?? s.items[0]?.artifactId ?? 'art.rework',
    acceptance: base?.acceptance ?? s.items[0]?.acceptance ?? [{ type: 'llm', prompt: f.reason }],
    ...(base ? { deps: [] } : {}),
  });
}

/**
 * 검사 단계 실패: 지적 대상 단계에 재작업 항목(r1, r2 …, 지적 원문 링크)을 붙이고 그 단계만 reopened.
 * 관련 없는 항목은 done 유지(4D.2). 다시 연 단계 뒤의 done 단계는 needs-recheck(4D.3).
 * 같은 검사가 3번 실패하면 검사 단계 blocked + 확인 카드 (오토 모드면 확인 목록, 4D.4).
 */
export function applyGateFailure(
  t: StageTree,
  gateStageId: string,
  findings: readonly GateFinding[],
  o: { mode?: RunMode; now?: () => Date } = {},
): GateFailureResult {
  const now = o.now ?? now0;
  let next = cloneTree(t);
  const gate = getStage(next, gateStageId);
  gate.failures += 1;
  const lastReason = findings.at(-1)?.reason ?? '검사 실패';
  if (gate.failures >= MAX_GATE_FAILURES) {
    if (gate.status !== 'blocked')
      next = setStageStatus(next, gateStageId, 'blocked', { reason: lastReason, now });
    const g = getStage(next, gateStageId);
    return {
      tree: next,
      reopened: [],
      recheck: [],
      rework: [],
      blocked:
        o.mode === 'auto'
          ? {
              review: {
                stageId: gateStageId,
                text: `${g.title} 검사를 ${MAX_GATE_FAILURES}번 통과하지 못했어요: ${lastReason}`,
              },
            }
          : { card: blockedCard(g, lastReason) },
    };
  }
  const flat = allStages(next);
  const order = new Map(flat.map((s, k) => [s.stageId, k]));
  const reopened: string[] = [];
  const rework: { stageId: string; itemId: string }[] = [];
  for (const f of findings) {
    const s = getStage(next, f.stageId);
    const n = Object.values(s.itemMeta).filter((m) => m.origin === 'rework').length + 1;
    const it = reworkItem(s, n, f);
    s.items.push(it);
    s.itemMeta[it.id] = {
      origin: 'rework',
      rework: n,
      gateStageId,
      note: f.reason,
      ...(f.itemId ? { reworkOf: f.itemId } : {}),
      ...(f.link ? { link: f.link } : {}),
    };
    rework.push({ stageId: s.stageId, itemId: it.id });
    if (!reopened.includes(s.stageId)) {
      if (s.status === 'done' || s.status === 'needs-recheck' || s.status === 'blocked')
        s.status = 'reopened';
      reopened.push(s.stageId);
    }
  }
  // 다시 연 단계 뒤의 done 단계 → needs-recheck (검사 단계 자신은 다시 돌 때 새로 판정)
  const first = Math.min(...reopened.map((id) => order.get(id)!));
  const recheck: string[] = [];
  for (const s of allStages(next)) {
    if (order.get(s.stageId)! <= first || reopened.includes(s.stageId)) continue;
    if (s.status === 'done' && !reopened.some((r) => s.stageId.startsWith(`${r}.`))) {
      s.status = 'needs-recheck';
      recheck.push(s.stageId);
    }
  }
  // 검사 단계 자신은 다시 돌 때까지 대기
  const g = getStage(next, gateStageId);
  if (g.status === 'verifying' || g.status === 'running') g.status = 'running';
  next.updatedAt = now().toISOString();
  return { tree: next, reopened, recheck, rework };
}

/** 4D.3 다시 확인: needs-recheck 단계를 다시 지날 때 출구 조건만 재검사 (통과하면 그대로 done) */
export function recheckStage(
  t: StageTree,
  stageId: string,
  ctx: ExitContext & { now?: () => Date } = {},
): { tree: StageTree; done: boolean; reason?: string } {
  const s = getStage(t, stageId);
  if (s.status !== 'needs-recheck') return { tree: t, done: s.status === 'done' };
  return completeStage(t, stageId, ctx);
}

/** 재작업 항목 완료 표시 (실행기 원장이 끝났을 때) */
export function markItemsDone(
  t: StageTree,
  stageId: string,
  ids?: readonly string[],
  now?: () => Date,
): StageTree {
  const next = cloneTree(t);
  const s = getStage(next, stageId);
  for (const i of s.items) if (!ids || ids.includes(i.id)) i.status = 'done';
  next.updatedAt = (now ?? now0)().toISOString();
  return next;
}

/** 다음에 시작할 단계 (최상위 순서, join은 기다림이 끝난 뒤) */
export function nextStartable(t: Pick<StageTree, 'stages'>): Stage | undefined {
  return t.stages.find((s) => s.status === 'expected' && canStartStage(t, s.stageId).ok);
}
