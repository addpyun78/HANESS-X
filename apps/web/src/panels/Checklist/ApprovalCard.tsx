import { APPROVAL_BUTTONS, type ApprovalDecision, type PendingApproval } from './model.js';

export interface ApprovalCardProps {
  approval: PendingApproval;
  onDecide?: (decision: ApprovalDecision) => void;
  busy?: boolean;
  error?: string;
}

/** 36.4 승인 카드: 예상/실제 경로 + [동치 인정] [이동 승인] [실패] */
export function ApprovalCard({ approval: a, onDecide, busy, error }: ApprovalCardProps) {
  return (
    <div className="hx-ck-approval" role="group" aria-label={`경로 판정 승인: ${a.itemId}`}>
      <div className="hx-ck-approval__head">
        <strong>경로 판정 확인</strong>
        {a.itemId && <span className="hx-mono">#{a.itemId}</span>}
      </div>
      <dl className="hx-ck-approval__paths">
        <dt>예상 경로</dt>
        <dd className="hx-mono" data-testid="approval-expected">
          {a.expectedPath}
        </dd>
        <dt>실제 경로</dt>
        <dd className="hx-mono" data-testid="approval-actual">
          {a.actualPath}
        </dd>
      </dl>
      {a.reason && <p className="hx-ck-approval__reason">{a.reason}</p>}
      <div className="hx-ck-approval__buttons">
        {APPROVAL_BUTTONS.map((b) => (
          <button
            key={b.id}
            type="button"
            className="hx-ck-btn"
            data-decision={b.id}
            disabled={busy || !onDecide}
            onClick={() => onDecide?.(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="hx-ck-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
