import { useContext } from 'react';
import { ApprovalFocusContext } from './useApprovals.js';
import { AREA_TITLE, type ApprovalCardData } from './model.js';
import './approvals.css';

/** 채팅 스트림 축소 카드 (T-100 H.14) — 누르면 패널의 카드로 스크롤·포커스 */
export function MiniApprovalCard({ approvalId, card }: { approvalId: string; card?: ApprovalCardData }) {
  const focus = useContext(ApprovalFocusContext);
  return (
    <button
      type="button"
      className="hx-approval-mini"
      data-approval-id={approvalId}
      aria-label={`${AREA_TITLE}${card ? ` (항목 ${card.itemId})` : ''} — 카드 보기`}
      onClick={() => focus?.focus(approvalId)}
    >
      <span aria-hidden="true">✋</span>
      <span>
        {AREA_TITLE}
        {card ? ` — ${card.whatHappened}` : ''}
      </span>
      <span className="hx-approval-mini__go">카드 보기 ›</span>
    </button>
  );
}
