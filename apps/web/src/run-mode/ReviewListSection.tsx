import './run-mode.css';
import { act } from '../actions/registry.js';
/**
 * T-101 3D.7 "돌아오면 확인할 것" 패널 섹션 — 오토 모드가 사람에게 미룬 일.
 * 항목마다 이유(쉬운 말) + 처리 버튼. 모양은 kernel run-mode/review-list.ts ReviewItem과 같다.
 */

export type ReviewKindView = 'permission' | 'verdict' | 'human-only' | 'plan' | 'limit';
export type ReviewActionView = 'allow' | 'deny' | 'open' | 'retry' | 'do-it' | 'dismiss';

export interface ReviewItemView {
  id: string;
  kind: ReviewKindView;
  reason: string;
  itemId?: string;
  actions: ReviewActionView[];
  at: string;
}

export const REVIEW_KIND_LABEL: Readonly<Record<ReviewKindView, { icon: string; label: string }>> =
  Object.freeze({
    permission: { icon: '🔐', label: '허락이 필요해요' },
    verdict: { icon: '⚖', label: '결과 확인' },
    'human-only': { icon: '🖐', label: '직접 하셔야 해요' },
    plan: { icon: '📝', label: '할 일 목록 확인' },
    limit: { icon: '⏱', label: '한도에 닿았어요' },
  });

export const REVIEW_ACTION_LABEL: Readonly<Record<ReviewActionView, string>> = Object.freeze({
  allow: '허락하기',
  deny: '하지 않기',
  open: '카드 열기',
  retry: '다시 해 보기',
  'do-it': '직접 하기',
  dismiss: '확인했어요',
});

export const REVIEW_SECTION_TITLE = '돌아오면 확인할 것';

export interface ReviewListSectionProps {
  items: readonly ReviewItemView[];
  onAction: (id: string, action: ReviewActionView) => void;
}

export function ReviewListSection({ items, onAction }: ReviewListSectionProps) {
  return (
    <section className="hx-review" aria-label={REVIEW_SECTION_TITLE}>
      <h3 className="hx-review__title">
        {REVIEW_SECTION_TITLE} <span className="hx-review__count">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="hx-review__empty">확인할 것이 없어요.</p>
      ) : (
        <ul className="hx-review__list">
          {items.map((it) => {
            const k = REVIEW_KIND_LABEL[it.kind];
            return (
              <li
                key={it.id}
                className={`hx-review__item hx-review__item--${it.kind}`}
                data-review-id={it.id}
              >
                <div className="hx-review__head">
                  <span aria-hidden="true">{k.icon}</span> <strong>{k.label}</strong>
                  {it.itemId && <span className="hx-mono hx-review__ref">#{it.itemId}</span>}
                </div>
                <p className="hx-review__reason">{it.reason}</p>
                <div className="hx-review__actions">
                  {it.actions.map((a, i) => (
                    <button
                      key={a}
                      type="button"
                      className={`hx-ck-btn${i === 0 ? ' hx-ck-btn--primary' : ''}`}
                      {...act('run-mode.review-action')}
                      onClick={() => onAction(it.id, a)}
                    >
                      {REVIEW_ACTION_LABEL[a]}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
