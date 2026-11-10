import {
  learnEquivalence,
  type Acceptance,
  type ManifestStore,
  type VerdictKind,
} from '@harness-x/checklist-ledger';
import {
  deviationKindQuestion,
  minimizeJudgeState,
  sameArtifactQuestion,
  type ChoiceAnswer,
  type DeviationKind,
  type NoulAnswer,
  type Verifier,
} from '@harness-x/protocol';
import type { LadderResult } from './ladder.js';

/**
 * 판정 사다리 L4 — 경량 판정 모델 (T-026)
 * L3가 escalate=true(위치만 다름 등)로 넘긴 결과만 받는다. 질문 2개를 판정기에 보낸다.
 *   same_artifact (noul) → p = "같은 산출물"일 확률
 *   deviation_kind (choice) → equivalent | relocated-ok | wrong-target | missing
 * 결정 (임계값은 설정 가능, 기본 accept 0.9 · fail 0.6):
 *   p ≥ accept 이고 종류가 equivalent/relocated-ok → 인정 (+ 별칭 자동 추가)
 *   p < fail → 실패
 *   그 밖(0.6 ≤ p < 0.9, 또는 p는 높은데 종류가 wrong-target/missing) → L5
 * 판정기가 off(null)이거나 오류가 나면 L5로 직행한다.
 */

export interface L4Thresholds {
  /** 이 값 이상이면 자동 인정 */
  accept: number;
  /** 이 값 미만이면 실패 */
  fail: number;
}

export const DEFAULT_L4_THRESHOLDS: Readonly<L4Thresholds> = Object.freeze({ accept: 0.9, fail: 0.6 });

export type L4Decision = 'accept' | 'escalate' | 'fail';

export function resolveThresholds(t: Partial<L4Thresholds> = {}): L4Thresholds {
  const r = { ...DEFAULT_L4_THRESHOLDS, ...t };
  if (!(r.fail >= 0 && r.accept <= 1 && r.fail <= r.accept))
    throw new RangeError(`L4 임계값은 0 ≤ fail ≤ accept ≤ 1 (받은 값 fail=${r.fail}, accept=${r.accept})`);
  return r;
}

/** p(같은 산출물)와 어긋남 종류 → 결정 */
export function decideL4(p: number, kind: DeviationKind, thresholds: Partial<L4Thresholds> = {}): L4Decision {
  const t = resolveThresholds(thresholds);
  if (p < t.fail) return 'fail';
  if (p >= t.accept && (kind === 'equivalent' || kind === 'relocated-ok')) return 'accept';
  return 'escalate';
}

export interface L4Result extends Omit<LadderResult, 'level'> {
  level: 4;
  /** skipped = 판정기 off 또는 오류 → L5 */
  decision: L4Decision | 'skipped';
  verifierId?: string;
  deviation?: DeviationKind;
  answers?: { sameArtifact: NoulAnswer; deviationKind: ChoiceAnswer };
}

export interface L4Options {
  /** null = off (L5로 직행) */
  verifier: Verifier | null;
  /** 항목 제목 (판정기에 보내는 메타데이터) */
  itemTitle: string;
  /** 심볼 목록 (없으면 acceptance의 symbol 조건에서 뽑는다) */
  symbols?: readonly string[];
  acceptance?: readonly Acceptance[];
  thresholds?: Partial<L4Thresholds>;
  /** 인정 시 호출 (별칭 자동 추가) — learnL4Alias()로 만든다 */
  onAccept?: (r: L4Result) => void | Promise<void>;
  signal?: AbortSignal;
}

/** acceptance의 symbol 조건 → 심볼 목록 */
export function symbolsOf(acceptance: readonly Acceptance[] = []): string[] {
  return acceptance.flatMap((a) => (a.type === 'symbol' ? [a.symbol] : []));
}

function baseName(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

export async function runLadderL4(prev: LadderResult, opts: L4Options): Promise<LadderResult | L4Result> {
  if (!prev.escalate) return prev;
  const base = { ...prev, level: 4 as const };
  if (!opts.verifier)
    return { ...base, decision: 'skipped', escalate: true, reason: `L4 판정기 off → L5 (${prev.reason})` };
  const thresholds = resolveThresholds(opts.thresholds);
  const state = minimizeJudgeState({
    itemTitle: opts.itemTitle,
    expectedPath: prev.expectedPath || '.',
    ...(prev.actualPath ? { actualPath: prev.actualPath } : {}),
    candidates: prev.candidates.map((c) => c.path),
    fileNames: [prev.expectedPath, ...(prev.actualPath ? [prev.actualPath] : [])].map(baseName),
    symbols: opts.symbols ? [...opts.symbols] : symbolsOf(opts.acceptance),
  });
  let same: NoulAnswer;
  let dev: ChoiceAnswer;
  try {
    const sig = opts.signal ? { signal: opts.signal } : {};
    same = await opts.verifier.judge(sameArtifactQuestion(), state, sig);
    dev = await opts.verifier.judge(deviationKindQuestion(), state, sig);
  } catch (err) {
    return {
      ...base,
      decision: 'skipped',
      verifierId: opts.verifier.id,
      escalate: true,
      reason: `L4 판정기(${opts.verifier.id}) 오류 → L5: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const kind = dev.choice as DeviationKind;
  const p = same.noul;
  const decision = decideL4(p, kind, thresholds);
  const common = {
    ...base,
    decision,
    verifierId: opts.verifier.id,
    deviation: kind,
    answers: { sameArtifact: same, deviationKind: dev },
  };
  const tag = `${opts.verifier.id}: same_artifact=${p}, deviation_kind=${kind}(${dev.confidence})`;
  let r: L4Result;
  if (decision === 'accept') {
    const verdict: VerdictKind = kind === 'equivalent' ? 'equal' : 'relocated';
    r = {
      ...common,
      verdict,
      confidence: round(p),
      escalate: false,
      reason: `L4 인정 (p ≥ ${thresholds.accept}) — ${tag}`,
    };
  } else if (decision === 'fail') {
    r = {
      ...common,
      verdict: kind === 'missing' ? 'missing' : 'wrong',
      confidence: round(1 - p),
      escalate: false,
      reason: `L4 실패 (p < ${thresholds.fail}) — ${tag}`,
    };
  } else {
    r = {
      ...common,
      confidence: round(p),
      escalate: true,
      reason: `L4 불확실 → L5 — ${tag}`,
    };
  }
  if (decision === 'accept' && opts.onAccept) await opts.onAccept(r);
  return r;
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
