import type { ReactNode } from 'react';
import type { LintViolation } from './model.js';

export interface PlanReviewProps {
  violations: readonly LintViolation[];
  onApprove?: () => void;
  busy?: boolean;
  error?: string;
  /** 검토할 항목 트리 */
  children?: ReactNode;
}

const RULE_LABEL: Record<string, string> = {
  R1: '단일 동사',
  R2: '산출물 1개',
  R3: '기계 검증 가능',
  R4: '크기 상한',
  R5: 'deps 순환 금지',
};

/** 36.5 Lock 전 계획 검토: 린터 위반 표시 + [승인] → Lock */
export function PlanReview({ violations, onApprove, busy, error, children }: PlanReviewProps) {
  const blocked = violations.length > 0;
  return (
    <section className="hx-ck-review" aria-label="계획 검토">
      <div className="hx-ck-review__head">
        <strong>Lock 전 계획 검토</strong>
        <span className="hx-ck-review__hint">승인하면 산출물 경로가 확정(Lock)됩니다</span>
      </div>
      {blocked ? (
        <ul className="hx-ck-review__violations" aria-label="린터 위반" data-testid="lint-violations">
          {violations.map((v, k) => (
            <li key={k} data-rule={v.rule}>
              <span className="hx-ck-tag hx-ck-tag--danger">
                {v.rule} {RULE_LABEL[v.rule] ?? ''}
              </span>{' '}
              <span className="hx-mono">#{v.itemId}</span> {v.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hx-ck-review__ok">린터 위반 없음</p>
      )}
      {children}
      <div className="hx-ck-review__actions">
        <button
          type="button"
          className="hx-ck-btn hx-ck-btn--primary"
          disabled={blocked || busy || !onApprove}
          onClick={onApprove}
        >
          승인
        </button>
        {blocked && <span className="hx-ck-review__hint">위반을 고친 뒤 승인할 수 있습니다</span>}
      </div>
      {error && (
        <p className="hx-ck-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
