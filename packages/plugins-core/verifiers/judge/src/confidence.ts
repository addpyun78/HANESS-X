import type { DifferenceKind, JudgeAnswer, JudgeBackend, JudgePrompt, JudgeVerdict } from './types.js';

/**
 * E.10 신뢰도 = judge.samples회 반복 일치율
 *   - same_meaning(예/아니오): '예' 비율
 *   - difference_kind(선택형): 최빈값 비율
 *   - 호출은 병렬, 판정 1건 최대 3회·60초. 시간 초과·답 불량 → unavailable
 * E.11 임계값: ≥0.9 equal / 0.6 이상 0.9 미만 uncertain(승인 카드) / <0.6 different
 */

export const JUDGE_MAX_SAMPLES = 3;
export const JUDGE_TIMEOUT_MS = 60_000;
export const EQUAL_THRESHOLD = 0.9;
export const UNCERTAIN_THRESHOLD = 0.6;

export function clampSamples(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(JUDGE_MAX_SAMPLES, Math.max(1, Math.floor(n)));
}

/** '예' 비율 (답이 없으면 0) */
export function yesRatio(answers: readonly JudgeAnswer[]): number {
  if (!answers.length) return 0;
  return answers.filter((a) => a.same_meaning === 'yes').length / answers.length;
}

/** 최빈값과 그 비율 (동률이면 먼저 나온 값) */
export function modeRatio<T>(values: readonly T[]): { value?: T; ratio: number } {
  if (!values.length) return { ratio: 0 };
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) [best, bestN] = [v, n];
  return { value: best, ratio: bestN / values.length };
}

/** E.11 신뢰도 → 판정 */
export function verdictForConfidence(confidence: number): Exclude<JudgeVerdict, 'unavailable'> {
  if (confidence >= EQUAL_THRESHOLD) return 'equal';
  if (confidence >= UNCERTAIN_THRESHOLD) return 'uncertain';
  return 'different';
}

export interface Aggregate {
  verdict: Exclude<JudgeVerdict, 'unavailable'>;
  confidence: number;
  differenceKind?: DifferenceKind;
  differenceKindRatio: number;
  plainReason?: string;
}

/** 표본들 → 신뢰도·판정·차이 종류(최빈)·쉬운 말 사유(다수 쪽 답에서) */
export function aggregateAnswers(answers: readonly JudgeAnswer[]): Aggregate {
  const confidence = yesRatio(answers);
  const verdict = verdictForConfidence(confidence);
  const kinds = answers.map((a) => a.difference_kind).filter((k): k is DifferenceKind => !!k);
  const { value: differenceKind, ratio: differenceKindRatio } = modeRatio(kinds);
  const majority = confidence >= 0.5 ? 'yes' : 'no';
  const plainReason =
    answers.find((a) => a.same_meaning === majority && a.plain_reason)?.plain_reason ??
    answers.find((a) => a.plain_reason)?.plain_reason;
  return {
    verdict,
    confidence,
    ...(differenceKind ? { differenceKind } : {}),
    differenceKindRatio,
    ...(plainReason ? { plainReason } : {}),
  };
}

export type SampleResult =
  { ok: true; answers: JudgeAnswer[] } | { ok: false; reason: 'timeout' | 'invalid-answer' };

/**
 * 같은 질문을 n회(최대 3) 병렬로 묻는다. 60초(기본) 안에 모두 오지 않으면 timeout,
 * 표본 하나라도 답이 불량(재요청 후에도)이면 invalid-answer. 예외 없음.
 */
export async function sampleAnswers(
  backend: JudgeBackend,
  prompt: JudgePrompt,
  samples: number,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<SampleResult> {
  const n = clampSamples(samples);
  const ac = new AbortController();
  const onOuterAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), opts.timeoutMs ?? JUDGE_TIMEOUT_MS);
  });
  try {
    const all = Promise.all(
      Array.from({ length: n }, () => backend.ask(prompt, ac.signal).catch(() => undefined)),
    );
    const r = await Promise.race([all, timeout]);
    if (r === 'timeout' || ac.signal.aborted) {
      ac.abort();
      return { ok: false, reason: 'timeout' };
    }
    if (r.some((a) => !a)) return { ok: false, reason: 'invalid-answer' };
    return { ok: true, answers: r as JudgeAnswer[] };
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}
