import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage, ModelClient } from '@harness-x/kernel';
import {
  ApprovalRequestEventSchema,
  buildJudgeMessages,
  deviationKindQuestion,
  extractJsonObject,
  minimizeJudgeState,
  parseJudgeAnswer,
  sameArtifactQuestion,
  type ChoiceAnswer,
  type DeviationKind,
  type JudgeAnswerFor,
  type JudgeQuestion,
  type JudgeState,
  type NoulAnswer,
} from '@harness-x/protocol';
import { z } from 'zod';
import { readJson, withFileLock, writeFileAtomic } from './fs-util.js';
import { learnEquivalence, type LearnEquivalenceResult } from './learn.js';
import type { ChecklistLedger, EventSink } from './ledger.js';
import { UnknownArtifactError, type ManifestEntry, type ManifestStore } from './manifest.js';
import type { Acceptance, ItemStatus, Verdict, VerdictKind } from './schema.js';

/**
 * 판정 사다리 L5 — 상위 검증 (T-027)
 * L4가 확정하지 못한 경우(0.6 ≤ p < 0.9, 판정기 off·오류)를 받는다.
 *   1) 작성 엔진과 "다른" 엔진에 L4와 같은 질문 2개를 JSON 응답 강제로 묻는다 (27.1)
 *   2) 그래도 불확실하면 approval_request(승인 카드)를 남기고 사람의 답을 기다린다 (27.2)
 *   3) POST /api/approvals/:id {equivalent|move|fail} → 항목 상태 변경 (27.3)
 *   4) 동치 인정 → glossary·manifest 별칭 자동 추가 (27.4), 이동 승인 → manifest 경로·참조 항목 갱신 (27.5)
 */

// ── 판정 대상 ─────────────────────────────────────────────────────
export interface EscalationCase {
  itemId: string;
  artifactId: string;
  itemTitle: string;
  /** 기대(정식) 경로 */
  expectedPath: string;
  /** 실제로 쓰인 경로 */
  actualPath: string;
  /** 하위 칸(L3·L4)의 판정 근거 */
  reason: string;
  /** 산출물을 쓴 엔진 — L5는 이 엔진에 묻지 않는다 */
  writerEngineId?: string;
  symbols?: string[];
  candidates?: string[];
}

// ── 27.1 다른 엔진에 같은 질문 ─────────────────────────────────────
/** 엔진 → ModelClient 생성기 (주입). 커널 엔진 설정·어댑터에서 만든다 */
export interface EngineClientFactory {
  /** 사용할 수 있는 엔진 ID (우선순위 순) */
  engineIds(): readonly string[];
  client(engineId: string): ModelClient;
}

export interface EscalationThresholds {
  accept: number;
  fail: number;
}
export const DEFAULT_ESCALATION_THRESHOLDS: Readonly<EscalationThresholds> = Object.freeze({
  accept: 0.9,
  fail: 0.6,
});

export type L5Decision = 'accept' | 'escalate' | 'fail';

/** L4와 같은 규칙: p < fail → 실패, p ≥ accept 이고 동치/허용 이동 → 인정, 그 밖은 사람에게 */
export function decideL5(
  p: number,
  kind: DeviationKind,
  t: EscalationThresholds = DEFAULT_ESCALATION_THRESHOLDS,
): L5Decision {
  if (p < t.fail) return 'fail';
  if (p >= t.accept && (kind === 'equivalent' || kind === 'relocated-ok')) return 'accept';
  return 'escalate';
}

/** JSON 응답 강제 지시 (엔진은 생성형 LLM이므로 system에 덧붙인다) */
export const FORCE_JSON_INSTRUCTION =
  'Respond with ONLY one JSON object that matches answerSchema. No prose, no markdown, no code fences.';

export interface OtherEngineAnswer {
  /** 질문한 엔진 (없으면 null — 다른 엔진이 없음) */
  engineId: string | null;
  decision: L5Decision;
  deviation?: DeviationKind;
  answers?: { sameArtifact: NoulAnswer; deviationKind: ChoiceAnswer };
  reason: string;
}

export function escalationState(c: EscalationCase): JudgeState {
  return minimizeJudgeState({
    itemTitle: c.itemTitle,
    expectedPath: c.expectedPath,
    actualPath: c.actualPath,
    candidates: c.candidates ?? [],
    fileNames: [c.expectedPath, c.actualPath].map((p) => p.split('/').filter(Boolean).pop() ?? p),
    symbols: c.symbols ?? [],
  });
}

/** 작성 엔진이 아닌 첫 엔진 */
export function pickOtherEngine(ids: readonly string[], writerEngineId?: string): string | null {
  return ids.find((id) => id !== writerEngineId) ?? null;
}

async function askJson<Q extends JudgeQuestion>(
  client: ModelClient,
  q: Q,
  state: JudgeState,
  signal?: AbortSignal,
): Promise<JudgeAnswerFor<Q>> {
  const m = buildJudgeMessages(q, state);
  const messages: ChatMessage[] = [
    { role: 'system', content: `${m.system}\n${FORCE_JSON_INSTRUCTION}` },
    { role: 'user', content: m.user },
  ];
  let lastErr: unknown;
  // 형식이 틀리면 한 번 더 요구한다
  for (let attempt = 0; attempt < 2; attempt++) {
    const turn = await client.complete({ messages, tools: [], ...(signal ? { signal } : {}) });
    try {
      return parseJudgeAnswer(q, extractJsonObject(turn.text));
    } catch (err) {
      lastErr = err;
      messages.push(
        { role: 'assistant', content: turn.text },
        { role: 'user', content: `Invalid answer. ${FORCE_JSON_INSTRUCTION}` },
      );
    }
  }
  throw lastErr;
}

/** 27.1 L5 상위 검증: 다른 엔진에 same_artifact·deviation_kind를 묻는다 */
export async function askOtherEngine(
  c: EscalationCase,
  opts: { engines: EngineClientFactory; thresholds?: EscalationThresholds; signal?: AbortSignal },
): Promise<OtherEngineAnswer> {
  const engineId = pickOtherEngine(opts.engines.engineIds(), c.writerEngineId);
  if (!engineId)
    return { engineId: null, decision: 'escalate', reason: '작성 엔진과 다른 엔진이 없어 사람에게 묻는다' };
  const client = opts.engines.client(engineId);
  const state = escalationState(c);
  let same: NoulAnswer;
  let dev: ChoiceAnswer;
  try {
    same = await askJson(client, sameArtifactQuestion(), state, opts.signal);
    dev = await askJson(client, deviationKindQuestion(), state, opts.signal);
  } catch (err) {
    return {
      engineId,
      decision: 'escalate',
      reason: `엔진 ${engineId} 판정 실패 → 사람: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const deviation = dev.choice as DeviationKind;
  const decision = decideL5(same.noul, deviation, opts.thresholds);
  return {
    engineId,
    decision,
    deviation,
    answers: { sameArtifact: same, deviationKind: dev },
    reason: `L5 ${engineId}: same_artifact=${same.noul}, deviation_kind=${deviation}(${dev.confidence}) → ${decision}`,
  };
}

// ── 27.2 승인 카드 (approval_request) ─────────────────────────────────
export const APPROVAL_DECISIONS = ['equivalent', 'move', 'fail'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export const ApprovalDecisionSchema = z.enum(APPROVAL_DECISIONS);

/** 버튼 3개: [동치 인정] [이동 승인] [실패] */
export const APPROVAL_BUTTONS = [
  { id: 'equivalent', label: '동치 인정' },
  { id: 'move', label: '이동 승인' },
  { id: 'fail', label: '실패' },
] as const satisfies readonly { id: ApprovalDecision; label: string }[];

export const LADDER_APPROVAL_KIND = 'ladder.l5';

export const LadderApprovalDetailSchema = z
  .object({
    itemId: z.string().min(1),
    artifactId: z.string().min(1),
    /** 예상 경로 */
    expectedPath: z.string().min(1),
    /** 실제 경로 */
    actualPath: z.string().min(1),
    /** 판정 근거 */
    reason: z.string().min(1),
    /** L5 다른 엔진의 답 (물어봤다면) */
    engine: z
      .object({
        engineId: z.string().min(1).nullable(),
        decision: z.enum(['accept', 'escalate', 'fail']),
        reason: z.string(),
      })
      .strict()
      .optional(),
    buttons: z
      .array(z.object({ id: ApprovalDecisionSchema, label: z.string().min(1) }).strict())
      .length(3)
      .refine((b) => b.map((x) => x.id).join() === APPROVAL_DECISIONS.join(), {
        message: '버튼은 equivalent, move, fail 순서의 3개',
      }),
  })
  .strict();
export type LadderApprovalDetail = z.infer<typeof LadderApprovalDetailSchema>;

export const LadderApprovalRequestEventSchema = ApprovalRequestEventSchema.extend({
  kind: z.literal(LADDER_APPROVAL_KIND),
  itemId: z.string().min(1),
  detail: LadderApprovalDetailSchema,
  options: z.tuple([z.literal('equivalent'), z.literal('move'), z.literal('fail')]),
});
export type LadderApprovalRequestEvent = z.infer<typeof LadderApprovalRequestEventSchema>;

// ── 대기 중인 승인 (approvals.json) ────────────────────────────────────
export interface StoredApproval {
  approvalId: string;
  case: EscalationCase;
  createdAt: string;
  status: 'pending' | 'resolved';
  decision?: ApprovalDecision;
  by?: string;
  resolvedAt?: string;
}

export const APPROVALS_FILE = 'approvals.json';

export class ApprovalNotFoundError extends Error {
  readonly code = 'APPROVAL_NOT_FOUND';
  constructor(readonly approvalId: string) {
    super(`없는 승인 요청: ${approvalId}`);
    this.name = 'ApprovalNotFoundError';
  }
}

export class ApprovalResolvedError extends Error {
  readonly code = 'APPROVAL_RESOLVED';
  constructor(readonly approvalId: string) {
    super(`이미 처리된 승인 요청: ${approvalId}`);
    this.name = 'ApprovalResolvedError';
  }
}

/** 승인 요청 저장소 — 재시작 후에도 POST /api/approvals/:id가 처리되도록 파일에 둔다 */
export class ApprovalStore {
  readonly file: string;
  constructor(dir: string, fileName = APPROVALS_FILE) {
    this.file = join(dir, fileName);
  }

  all(): Record<string, StoredApproval> {
    if (!existsSync(this.file)) return {};
    return (readJson(this.file) as { approvals: Record<string, StoredApproval> }).approvals;
  }

  get(id: string): StoredApproval {
    const a = this.all()[id];
    if (!a) throw new ApprovalNotFoundError(id);
    return a;
  }

  pending(): StoredApproval[] {
    return Object.values(this.all()).filter((a) => a.status === 'pending');
  }

  put(a: StoredApproval): void {
    withFileLock(`${this.file}.lock`, () => {
      const approvals = { ...this.all(), [a.approvalId]: a };
      writeFileAtomic(this.file, JSON.stringify({ version: 1, approvals }, null, 2) + '\n');
    });
  }
}

export interface EscalatorOptions {
  /** approvals.json을 둘 폴더 (보통 체크리스트 폴더) */
  dir: string;
  sessionId: string;
  log?: EventSink;
  /** L5 다른 엔진 (없으면 바로 사람에게) */
  engines?: EngineClientFactory;
  thresholds?: EscalationThresholds;
  /** 체크리스트 원장 — 결정을 항목 상태에 반영 (27.3) */
  ledger?: ChecklistLedger;
  /** 경로 원장 — 동치 인정 시 별칭(27.4), 이동 승인 시 경로 갱신(27.5) */
  manifest?: ManifestStore;
  /** 프로젝트 glossary.json — 동치 인정 시 단어 별칭 추가 (27.4) */
  glossaryFile?: string;
  now?: () => Date;
  idGen?: () => string;
}

export type EscalationOutcome =
  | {
      status: 'decided';
      by: 'engine';
      engineId: string;
      decision: ApprovalDecision;
      engine: OtherEngineAnswer;
      /** 원장이 있으면 결정을 반영한 결과 */
      resolution?: ApprovalResolution;
    }
  | { status: 'pending'; approvalId: string; event: LadderApprovalRequestEvent; engine?: OtherEngineAnswer };

/** 엔진 답 → 버튼 (인정: 동치면 equivalent, 허용 이동이면 move / 실패: fail) */
export function engineDecision(a: OtherEngineAnswer): ApprovalDecision | null {
  if (a.decision === 'fail') return 'fail';
  if (a.decision === 'accept') return a.deviation === 'relocated-ok' ? 'move' : 'equivalent';
  return null;
}

export const APPROVAL_EVIDENCE_KIND = 'approval_resolution';

const VERDICT_OF: Record<ApprovalDecision, VerdictKind> = {
  equivalent: 'equal',
  move: 'relocated',
  fail: 'wrong',
};

export interface ApprovalResolution {
  itemId: string;
  decision: ApprovalDecision;
  /** 반영 후 항목 상태 */
  status: ItemStatus;
  verdict: Verdict;
  /** 동치 인정 시 사전 학습 결과 (27.4) */
  learned?: LearnEquivalenceResult;
  /** 이동 승인 시 manifest·참조 항목 갱신 결과 (27.5) */
  moved?: MoveArtifactResult;
}

export class Escalator {
  readonly approvals: ApprovalStore;
  protected readonly opts: EscalatorOptions;
  protected readonly now: () => Date;
  protected readonly idGen: () => string;

  constructor(opts: EscalatorOptions) {
    this.opts = opts;
    this.approvals = new ApprovalStore(opts.dir);
    this.now = opts.now ?? (() => new Date());
    this.idGen = opts.idGen ?? randomUUID;
  }

  /** L5: 다른 엔진에 묻고, 그래도 불확실하면 승인 카드를 남긴다 */
  async escalate(c: EscalationCase, opts: { signal?: AbortSignal } = {}): Promise<EscalationOutcome> {
    let engine: OtherEngineAnswer | undefined;
    if (this.opts.engines) {
      engine = await askOtherEngine(c, {
        engines: this.opts.engines,
        ...(this.opts.thresholds ? { thresholds: this.opts.thresholds } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const decision = engineDecision(engine);
      if (decision && engine.engineId) {
        const by = `engine:${engine.engineId}`;
        const resolution = this.opts.ledger ? this.apply(c, decision, { by }) : undefined;
        return {
          status: 'decided',
          by: 'engine',
          engineId: engine.engineId,
          decision,
          engine,
          ...(resolution ? { resolution } : {}),
        };
      }
    }
    const { approvalId, event } = this.requestApproval(c, engine);
    return { status: 'pending', approvalId, event, ...(engine ? { engine } : {}) };
  }

  /**
   * 27.3 승인 카드 응답 (커널 API POST /api/approvals/:id의 ApprovalHandler)
   * 없는 id → ApprovalNotFoundError(404), 이미 처리됨 → ApprovalResolvedError(409)
   */
  resolve(approvalId: string, decision: ApprovalDecision, meta: { by?: string } = {}): ApprovalResolution {
    const a = this.approvals.get(approvalId);
    if (a.status !== 'pending') throw new ApprovalResolvedError(approvalId);
    const by = meta.by ?? 'human';
    const res = this.apply(a.case, ApprovalDecisionSchema.parse(decision), { by, approvalId });
    this.approvals.put({ ...a, status: 'resolved', decision, by, resolvedAt: this.now().toISOString() });
    return res;
  }

  /** 결정 → 항목 상태: equivalent·move → done, fail → failed (verdict L5 + evidence) */
  apply(
    c: EscalationCase,
    decision: ApprovalDecision,
    meta: { by: string; approvalId?: string },
  ): ApprovalResolution {
    const ledger = this.opts.ledger;
    if (!ledger) throw new Error('Escalator에 ledger가 없어 결정을 반영할 수 없습니다');
    const verdictKind: VerdictKind = VERDICT_OF[decision];
    const label = APPROVAL_BUTTONS.find((b) => b.id === decision)!.label;
    const verdict: Verdict = {
      level: 5,
      verdict: verdictKind,
      confidence: 1,
      reason: `L5 ${label} (${meta.by}): ${c.expectedPath} ↔ ${c.actualPath}`,
    };
    const evidence = {
      kind: APPROVAL_EVIDENCE_KIND,
      summary: verdict.reason,
      decision,
      by: meta.by,
      ...(meta.approvalId ? { approvalId: meta.approvalId } : {}),
      expectedPath: c.expectedPath,
      actualPath: c.actualPath,
    };
    // 27.4 동치 인정 → manifest 별칭 + glossary 단어 별칭 (다음 판정은 L2에서 끝난다)
    const learned =
      decision === 'equivalent' && (this.opts.manifest || this.opts.glossaryFile)
        ? learnEquivalence({
            expectedPath: c.expectedPath,
            actualPath: c.actualPath,
            reason: `L5 동치 인정 (${meta.by}): ${c.expectedPath} ≡ ${c.actualPath}`,
            artifactId: c.artifactId,
            ...(this.opts.manifest ? { manifest: this.opts.manifest } : {}),
            ...(this.opts.glossaryFile ? { glossaryFile: this.opts.glossaryFile } : {}),
          })
        : undefined;
    // 27.5 이동 승인 → manifest 경로를 실제 경로로 갱신 + 참조 항목 일괄 갱신
    const moved =
      decision === 'move' && this.opts.manifest
        ? moveArtifact({
            manifest: this.opts.manifest,
            ledger,
            artifactId: c.artifactId,
            newPath: c.actualPath,
            reason: `L5 이동 승인 (${meta.by}): ${c.expectedPath} → ${c.actualPath}`,
            now: this.now,
          })
        : undefined;
    const status: ItemStatus = decision === 'fail' ? 'failed' : 'done';
    if (ledger.item(c.itemId).status === 'doing') ledger.transition(c.itemId, 'verifying');
    ledger.transition(c.itemId, status, { verdict, evidence });
    return {
      itemId: c.itemId,
      decision,
      status,
      verdict,
      ...(learned ? { learned } : {}),
      ...(moved ? { moved } : {}),
    };
  }

  /** 승인 카드: approval_request(예상 경로/실제 경로/근거/버튼 3개) 이벤트 + 저장 */
  requestApproval(
    c: EscalationCase,
    engine?: OtherEngineAnswer,
  ): { approvalId: string; event: LadderApprovalRequestEvent } {
    const approvalId = this.idGen();
    const event = LadderApprovalRequestEventSchema.parse({
      id: this.idGen(),
      ts: this.now().toISOString(),
      sessionId: this.opts.sessionId,
      itemId: c.itemId,
      type: 'approval_request',
      approvalId,
      kind: LADDER_APPROVAL_KIND,
      title: `경로 판정 확인: ${c.expectedPath} ↔ ${c.actualPath}`,
      detail: {
        itemId: c.itemId,
        artifactId: c.artifactId,
        expectedPath: c.expectedPath,
        actualPath: c.actualPath,
        reason: engine ? `${c.reason} / ${engine.reason}` : c.reason,
        ...(engine
          ? { engine: { engineId: engine.engineId, decision: engine.decision, reason: engine.reason } }
          : {}),
        buttons: APPROVAL_BUTTONS.map((b) => ({ ...b })),
      },
      options: [...APPROVAL_DECISIONS],
    });
    this.approvals.put({ approvalId, case: c, createdAt: event.ts, status: 'pending' });
    this.opts.log?.append(event as Parameters<EventSink['append']>[0]);
    return { approvalId, event };
  }
}

// ── 27.5 이동 승인: manifest 경로 갱신 + 참조 항목 일괄 갱신 ─────────────────
export const PATH_UPDATED_EVIDENCE_KIND = 'path_updated';

/** p가 from 자체이거나 그 아래면 to 기준으로 옮긴 경로, 아니면 null */
export function rebasePath(p: string, from: string, to: string): string | null {
  if (p === from) return to;
  if (p.startsWith(`${from}/`)) return to + p.slice(from.length);
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 문자열 안의 경로 참조(from, from/…)를 to로 바꾼다. 경로 조각 경계에서만 (harness/mobile-old는 그대로) */
export function rewritePathRefs(text: string, from: string, to: string): string {
  const re = new RegExp(`(^|[\\s'"=:(,])(\\./)?${escapeRe(from)}(?=$|[/\\s'"):;,])`, 'g');
  return text.replace(re, (_m, pre: string, dot: string | undefined) => `${pre}${dot ?? ''}${to}`);
}

function rewriteAcceptance(a: Acceptance, from: string, to: string): Acceptance {
  const out: Record<string, unknown> = { ...a };
  if ('run' in a) out.run = rewritePathRefs(a.run, from, to);
  if ('file' in a && a.file !== undefined) out.file = rewritePathRefs(a.file, from, to);
  return out as Acceptance;
}

export interface MoveArtifactOptions {
  manifest: ManifestStore;
  ledger?: ChecklistLedger;
  artifactId: string;
  /** 새 정식 경로 (승인된 실제 경로) */
  newPath: string;
  reason: string;
  now?: () => Date;
}

export interface MoveArtifactResult {
  /** 개정 후 manifest revision */
  revision: number;
  /** 경로가 바뀐 산출물 (대상 + 그 아래에 있던 산출물) */
  moved: { artifactId: string; from: string; to: string }[];
  /** 경로를 갱신한 항목 (옮긴 산출물을 참조하거나 acceptance가 옛 경로를 가리키던 항목) */
  updatedItems: string[];
}

export function moveArtifact(opts: MoveArtifactOptions): MoveArtifactResult {
  const m = opts.manifest.read();
  const target = m?.artifacts[opts.artifactId];
  if (!m || !target) throw new UnknownArtifactError(opts.artifactId);
  const from = target.path;
  const to = opts.newPath;
  const changes: Record<string, ManifestEntry> = {};
  const moved: MoveArtifactResult['moved'] = [];
  for (const [id, e] of Object.entries(m.artifacts)) {
    const np = rebasePath(e.path, from, to);
    if (np === null || np === e.path) continue;
    const aliases = (e.aliases ?? []).filter((a) => a !== np);
    const { aliases: _old, ...rest } = e;
    changes[id] = { ...rest, path: np, ...(aliases.length ? { aliases } : {}) };
    moved.push({ artifactId: id, from: e.path, to: np });
  }
  const next = opts.manifest.revise(changes, { reason: opts.reason });
  const updatedItems: string[] = [];
  const ledger = opts.ledger;
  if (ledger && moved.length > 0) {
    const ts = (opts.now ?? (() => new Date()))().toISOString();
    const movedTo = new Map(moved.map((x) => [x.artifactId, x]));
    const items = ledger.get().items.map((it) => {
      const acceptance = it.acceptance.map((a) => rewriteAcceptance(a, from, to));
      const accChanged = JSON.stringify(acceptance) !== JSON.stringify(it.acceptance);
      const mv = movedTo.get(it.artifactId);
      if (!accChanged && !mv) return it;
      updatedItems.push(it.id);
      return {
        ...it,
        acceptance,
        evidence: [
          ...it.evidence,
          {
            kind: PATH_UPDATED_EVIDENCE_KIND,
            ts,
            summary: `경로 갱신 ${from} → ${to}`,
            artifactId: it.artifactId,
            from,
            to,
            ...(mv ? { artifactPath: mv.to } : {}),
            acceptanceUpdated: accChanged,
          },
        ],
      };
    });
    if (updatedItems.length > 0) ledger.revise(items);
  }
  return { revision: next.revision, moved, updatedItems };
}
