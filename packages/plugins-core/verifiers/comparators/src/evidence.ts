import { CompareEvidenceSchema, type CompareEvidence } from '@harness-x/checklist-ledger';
import type { CompareOutcome } from './compare.js';
import type { CompareResult } from './types.js';

/**
 * F.1 비교 증거: evidence에 `compare: { kind, level, verdict, confidence, judgeEngine?, samples?,
 * normalizedExpected, normalizedActual }`를 남긴다.
 * F.2 의미 판단(semantic)으로 통과한 비교는 aiJudged=true (항목에는 ledger가 `ai_judged: true`로 옮긴다).
 */

export interface CompareEvidenceOptions {
  /** 의미 판단 엔진 id (semantic 단계에서만) */
  judgeEngine?: string;
  /** 의미 판단 반복 횟수 */
  samples?: number;
  ts?: string;
  /** 정규화 값을 증거에 남길 때 최대 길이 (기본 2000) */
  maxValueLength?: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function aiJudged(r: Pick<CompareResult, 'verdict' | 'level'>): boolean {
  return r.verdict === 'equal' && r.level === 'semantic';
}

export function compareEvidence(
  o: Pick<
    CompareOutcome,
    'kind' | 'level' | 'verdict' | 'confidence' | 'reason' | 'normalizedExpected' | 'normalizedActual'
  >,
  opts: CompareEvidenceOptions = {},
): CompareEvidence {
  const n = opts.maxValueLength ?? 2000;
  return CompareEvidenceSchema.parse({
    kind: 'compare',
    ...(opts.ts ? { ts: opts.ts } : {}),
    summary: `${o.kind} ${o.verdict} (${o.level}, ${o.confidence.toFixed(2)}) — ${o.reason}`,
    compare: {
      kind: o.kind,
      level: o.level,
      verdict: o.verdict,
      confidence: o.confidence,
      ...(opts.judgeEngine ? { judgeEngine: opts.judgeEngine } : {}),
      ...(opts.samples !== undefined ? { samples: opts.samples } : {}),
      normalizedExpected: clip(o.normalizedExpected, n),
      normalizedActual: clip(o.normalizedActual, n),
    },
    ...(aiJudged(o) ? { ai_judged: true } : {}),
  });
}
