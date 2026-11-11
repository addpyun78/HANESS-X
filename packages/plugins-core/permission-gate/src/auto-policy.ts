import type { ChecklistLedger } from '@harness-x/checklist-ledger';
import type { ReviewList } from '@harness-x/kernel';
import type { ApprovalAsk } from './plan-gate.js';

/**
 * T-101 3D.2 오토 모드의 권한 요청 자동 처리 — 계획 게이트(createPlanGate)의 `approve` 자리에 꽂는다.
 *  - 정책 범위 안(워크스페이스 안, 계획의 산출물 목록에만 없는 경로) → 자동 허용
 *  - 범위 밖(워크스페이스 밖) → 자동 거부 + "돌아오면 확인할 것"에 기록 + 그 항목 blocked
 *    → 실행기는 blocked가 아닌 독립 항목(currentItem)을 계속한다.
 */

export const AUTO_DENIED_EVIDENCE = 'auto_denied';

export interface AutoApproverOptions {
  sessionId: string;
  review: Pick<ReviewList, 'add'>;
  /** 항목 blocked 처리 (없으면 기록만) */
  ledger?: Pick<ChecklistLedger, 'transition'>;
}

export type AutoDecision = 'allow' | 'deny';

/** 정책 판단만 (순수) */
export function autoPolicy(ask: Pick<ApprovalAsk, 'reason'>): AutoDecision {
  return ask.reason === '워크스페이스 밖' ? 'deny' : 'allow';
}

export function outsideReason(paths: readonly string[]): string {
  return `작업 폴더 밖에 파일을 쓰려고 해서 하지 않았어요: ${paths.join(', ')}`;
}

export function createAutoApprover(opts: AutoApproverOptions): (ask: ApprovalAsk) => boolean {
  return (ask) => {
    if (autoPolicy(ask) === 'allow') return true;
    const reason = outsideReason(ask.paths);
    opts.review.add({
      sessionId: opts.sessionId,
      kind: 'permission',
      reason,
      ...(ask.itemId ? { itemId: ask.itemId } : {}),
      detail: { approvalId: ask.approvalId, tool: ask.tool, paths: ask.paths },
    });
    if (ask.itemId && opts.ledger) {
      try {
        opts.ledger.transition(ask.itemId, 'blocked', {
          evidence: { kind: AUTO_DENIED_EVIDENCE, summary: reason, paths: ask.paths },
        });
      } catch {
        // 이미 끝난 항목이면 기록만 남긴다
      }
    }
    return false;
  };
}
