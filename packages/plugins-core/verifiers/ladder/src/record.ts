import {
  EvidenceSchema,
  VerdictSchema,
  type ChecklistLedger,
  type Evidence,
  type Verdict,
} from '@harness-x/checklist-ledger';
import type { LadderResult } from './ladder.js';
import type { L4Result } from './l4.js';

/** L1~L3 결과 또는 L4 결과 */
export type AnyLadderResult = LadderResult | L4Result;

/**
 * 판정 결과 기록 (25.5)
 * 사다리 결과를 항목 verdict {level, verdict, confidence, reason}과 evidence(kind: ladder_verdict)로 바꾼다.
 * evidence에는 경로·유사도·조건 통과 여부만 남기고 명령 출력 등 가변 텍스트는 넣지 않는다.
 */

export const LADDER_EVIDENCE_KIND = 'ladder_verdict';

export interface LadderEvidence extends Evidence {
  kind: typeof LADDER_EVIDENCE_KIND;
  level: AnyLadderResult['level'];
  /** L4 결정 (accept/escalate/fail/skipped) */
  decision?: L4Result['decision'];
  verdict: LadderResult['verdict'];
  confidence: number;
  reason: string;
  expectedPath: string;
  actualPath?: string;
  escalate: boolean;
  candidates: { path: string; similarity: number }[];
  checks?: { type: string; ok: boolean; skipped?: boolean }[];
}

export function toVerdict(r: AnyLadderResult): Verdict {
  return VerdictSchema.parse({
    level: r.level,
    verdict: r.verdict,
    confidence: r.confidence,
    reason: r.reason,
  });
}

export function toEvidence(r: AnyLadderResult, opts: { now?: () => Date } = {}): LadderEvidence {
  const ev: LadderEvidence = {
    kind: LADDER_EVIDENCE_KIND,
    ts: (opts.now ?? (() => new Date()))().toISOString(),
    summary: `L${r.level} ${r.verdict} (${r.confidence})`,
    level: r.level,
    verdict: r.verdict,
    confidence: r.confidence,
    reason: r.reason,
    expectedPath: r.expectedPath,
    ...(r.actualPath !== undefined ? { actualPath: r.actualPath } : {}),
    escalate: r.escalate,
    ...('decision' in r ? { decision: r.decision } : {}),
    candidates: r.candidates.map((c) => ({ path: c.path, similarity: c.similarity })),
    ...(r.checks
      ? { checks: r.checks.map((c) => ({ type: c.type, ok: c.ok, ...(c.skipped ? { skipped: true } : {}) })) }
      : {}),
  };
  EvidenceSchema.parse(ev);
  return ev;
}

/** 원장 항목에 판정 evidence 추가 (checklist_change 이벤트 발행은 원장이 한다) */
export function recordLadderEvidence(
  ledger: Pick<ChecklistLedger, 'addEvidence'>,
  itemId: string,
  r: AnyLadderResult,
  opts: { now?: () => Date; expectedVersion?: number } = {},
): LadderEvidence {
  const ev = toEvidence(r, opts);
  ledger.addEvidence(
    itemId,
    ev,
    opts.expectedVersion !== undefined ? { expectedVersion: opts.expectedVersion } : {},
  );
  return ev;
}
