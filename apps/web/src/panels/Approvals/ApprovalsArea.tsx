import { useEffect, useRef } from 'react';
import { NARROW_QUERY, useMediaQuery } from '../../shell/useMediaQuery.js';
import { ActionCard } from './ActionCard.js';
import {
  AREA_TITLE,
  BATCH_MESSAGE,
  BATCH_THRESHOLD,
  toActionCard,
  type ApprovalCardData,
  type ChoiceId,
} from './model.js';
import './approvals.css';

export interface ApprovalsAreaProps {
  cards: readonly ApprovalCardData[];
  onChoose?: (id: string, choice: ChoiceId, remember: boolean) => void;
  busy?: string;
  errors?: Record<string, string>;
  /** 방금 내린 선택 (취소 버튼·안내 문구) */
  last?: { cardId: string; message?: string };
  onUndo?: () => void;
  /** 이 카드로 스크롤·포커스 (채팅 축소 카드·알림 클릭) */
  focusId?: string;
  onFocused?: () => void;
  /** 강제 배치 (기본: 768px 미만이면 하단 시트) */
  variant?: 'panel' | 'sheet';
}

/**
 * "확인이 필요해요" 영역 (T-100 H.11·H.15·H.16)
 *  - 넓은 화면: 우측 패널 맨 위(체크리스트 위)에 고정, 여러 장이면 개수 배지
 *  - 768px 미만: 화면 아래 시트, 버튼 높이 48px 이상
 *  - 새 카드가 오면 첫 버튼으로 포커스, 숫자 키 1·2·3으로 고르기
 */
export function ApprovalsArea({
  cards,
  onChoose,
  busy,
  errors = {},
  last,
  onUndo,
  focusId,
  onFocused,
  variant,
}: ApprovalsAreaProps) {
  const narrow = useMediaQuery(NARROW_QUERY);
  const v = variant ?? (narrow ? 'sheet' : 'panel');
  const root = useRef<HTMLElement>(null);
  const firstId = cards[0]?.id;

  useEffect(() => {
    if (!focusId) return;
    const el = [...(root.current?.querySelectorAll<HTMLElement>('[data-card-id]') ?? [])].find(
      (x) => x.dataset.cardId === focusId,
    );
    if (el) {
      el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      el.querySelector<HTMLButtonElement>('button[data-choice]')?.focus();
    }
    onFocused?.();
  }, [focusId, onFocused]);

  if (cards.length === 0 && !last) return null;

  const kinds = new Map<string, number>();
  for (const c of cards) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
  const batch = [...kinds.entries()].find(([, n]) => n >= BATCH_THRESHOLD);

  return (
    <section
      ref={root}
      className={`hx-approvals hx-approvals--${v}`}
      aria-label={AREA_TITLE}
      data-variant={v}
      {...(v === 'sheet' ? { role: 'dialog', 'aria-modal': false } : {})}
    >
      <header className="hx-approvals__head">
        <h3>
          <span aria-hidden="true">✋ </span>
          {AREA_TITLE}
        </h3>
        {cards.length > 1 && (
          <span className="hx-approvals__count" aria-label={`카드 ${cards.length}장`}>
            {cards.length}
          </span>
        )}
      </header>
      {batch && (
        <p className="hx-approvals__batch" role="note">
          {BATCH_MESSAGE}
        </p>
      )}
      {cards.map((c) => (
        <ActionCard
          key={c.id}
          card={toActionCard(c)}
          busy={busy === c.id}
          autoFocus={c.id === firstId}
          {...(errors[c.id] ? { error: errors[c.id] } : {})}
          {...(onChoose
            ? {
                onChoose: (id: string, o: { checked: boolean }) => onChoose(c.id, id as ChoiceId, o.checked),
              }
            : {})}
        />
      ))}
      {last && (
        <p className="hx-approvals__last" role="status">
          {last.message ?? '선택을 반영했어요.'}{' '}
          {onUndo && (
            <button type="button" className="hx-approvals__undo" onClick={onUndo}>
              방금 선택 취소
            </button>
          )}
        </p>
      )}
    </section>
  );
}
