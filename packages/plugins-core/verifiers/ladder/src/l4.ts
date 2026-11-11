import { learnEquivalence, type ManifestStore, type VerdictKind } from '@harness-x/checklist-ledger';
import type { JudgeOutcome, JudgeRequest } from '@harness-x/judge';
import type { LadderResult } from './ladder.js';
import type { JudgeSettings } from './settings.js';

/**
 * 판정 사다리 L4 — 의미 판단 AI 체인 (T-025/T-026 → T-100 E.14)
 * L3가 escalate=true(위치만 다름 등)로 넘긴 결과만 받는다. 기대 경로·실제 경로를 judge 체인
 * (사용자 설정 AI → 로컬 Ollama → 로그인된 구독 엔진)에 path 비교로 묻는다.
 * 체인이 임계값(≥0.9 equal · 0.6~0.9 uncertain · <0.6 different, E.11)을 이미 적용하므로 결정은 그대로 옮긴다.
 *   equal       → 인정 (+ 별칭 자동 추가)
 *   different   → 실패 (difference_kind가 missing이면 missing, 그 밖은 wrong)
 *   uncertain   → L5 (승인 카드)
 *   unavailable → L5 (판정할 AI 없음·상한 초과)
 * 체인이 없거나(null) judge.semantic = off면 L5로 직행한다.
 */

export interface L4Thresholds {
  /** 이 값 이상이면 자동 인정 */
  accept: number;
  /** 이 값 미만이면 실패 */
  fail: number;
}

/** 체인 임계값(E.11)과 같은 값 — 참고용 */
export const DEFAULT_L4_THRESHOLDS: Readonly<L4Thresholds> = Object.freeze({ accept: 0.9, fail: 0.6 });

export type L4Decision = 'accept' | 'escalate' | 'fail';

/** judge 체인 (createJudgeChain 결과의 judge만 쓴다) */
export interface L4Judge {
  judge(req: JudgeRequest): Promise<JudgeOutcome>;
}

/** 체인 판정 → L4 결정 */
export function decideL4(o: Pick<JudgeOutcome, 'verdict'>): L4Decision | 'skipped' {
  switch (o.verdict) {
    case 'equal':
      return 'accept';
    case 'different':
      return 'fail';
    case 'uncertain':
      return 'escalate';
    case 'unavailable':
      return 'skipped';
  }
}

export interface L4Result extends Omit<LadderResult, 'level'> {
  level: 4;
  /** skipped = 체인 없음·판정할 AI 없음·상한 초과 → L5 */
  decision: L4Decision | 'skipped';
  /** 판정한 엔진 id (로컬이면 'ollama') */
  verifierId?: string;
  /** 체인 결과 원본 */
  judge?: JudgeOutcome;
}

export interface L4Options {
  /** null = 의미 판단 off (L5로 직행) */
  judge: L4Judge | null;
  /** 항목 제목 (판정기에 보내는 메타데이터) */
  itemTitle: string;
  /** 세션 id (세션 호출 상한, E.13) */
  sessionId?: string;
  /** 항목을 작성한 엔진 (E.7: 다른 엔진 우선) */
  authorEngineId?: string;
  /** 인정 시 호출 (별칭 자동 추가) — learnL4Alias()로 만든다 */
  onAccept?: (r: L4Result) => void | Promise<void>;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

export async function runLadderL4(prev: LadderResult, opts: L4Options): Promise<LadderResult | L4Result> {
  if (!prev.escalate) return prev;
  const base = { ...prev, level: 4 as const };
  if (!opts.judge)
    return { ...base, decision: 'skipped', escalate: true, reason: `L4 의미 판단 off → L5 (${prev.reason})` };
  const o = await opts.judge.judge({
    kind: 'path',
    expected: prev.expectedPath || '.',
    actual: prev.actualPath ?? prev.candidates[0]?.path ?? '',
    itemTitle: opts.itemTitle,
    sessionId: opts.sessionId ?? 'default',
    ...(opts.authorEngineId ? { authorEngineId: opts.authorEngineId } : {}),
  });
  const decision = decideL4(o);
  const tag = `${o.engineId ?? '판정 AI 없음'}: ${o.verdict} (${o.confidence.toFixed(2)}, ${o.reason})`;
  const common = {
    ...base,
    decision,
    ...(o.engineId ? { verifierId: o.engineId } : {}),
    judge: o,
  };
  let r: L4Result;
  if (decision === 'accept') {
    const verdict: VerdictKind = 'equal';
    r = { ...common, verdict, confidence: round(o.confidence), escalate: false, reason: `L4 인정 — ${tag}` };
  } else if (decision === 'fail') {
    r = {
      ...common,
      verdict: o.differenceKind === 'missing' ? 'missing' : 'wrong',
      confidence: round(1 - o.confidence),
      escalate: false,
      reason: `L4 실패 — ${tag}`,
    };
  } else if (decision === 'escalate') {
    r = { ...common, confidence: round(o.confidence), escalate: true, reason: `L4 불확실 → L5 — ${tag}` };
  } else {
    r = { ...common, escalate: true, reason: `L4 판정 불가 → L5 — ${tag}` };
  }
  if (decision === 'accept' && opts.onAccept) await opts.onAccept(r);
  return r;
}

// ── 판정기 선택 (T-100 J.3·J.4·E.14) ─────────────────────────────────
// 예전 설정 `verifier.l4`는 폐기했다(J.4). L4는 judge 체인(사용자 설정 AI → 로컬 → 구독 엔진)을 쓴다.

/** judge 설정 → L4가 쓸 체인. judge.semantic = off면 null(의미 판단 없이 L5로) */
export function selectL4Judge(settings: JudgeSettings, chain: L4Judge | null | undefined): L4Judge | null {
  if (settings.semantic === 'off') return null;
  return chain ?? null;
}

/** L4 인정 시 manifest·glossary 별칭 자동 추가 (다음 판정은 L2에서 끝난다) */
export function learnL4Alias(opts: {
  artifactId: string;
  manifest?: Pick<ManifestStore, 'addPathAlias'>;
  glossaryFile?: string;
}): (r: L4Result) => void {
  return (r) => {
    if (!r.actualPath) return;
    learnEquivalence({
      expectedPath: r.expectedPath,
      actualPath: r.actualPath,
      reason: `L4 ${r.verifierId ?? 'verifier'} 인정: ${r.expectedPath} ≡ ${r.actualPath}`,
      artifactId: opts.artifactId,
      ...(opts.manifest ? { manifest: opts.manifest } : {}),
      ...(opts.glossaryFile ? { glossaryFile: opts.glossaryFile } : {}),
    });
  };
}
