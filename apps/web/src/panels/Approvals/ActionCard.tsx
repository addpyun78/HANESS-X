import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ActionCardModel } from './model.js';

export interface ActionCardProps {
  card: ActionCardModel;
  onChoose?: (buttonId: string, opts: { checked: boolean }) => void;
  busy?: boolean;
  error?: string;
  /** 처음 나타날 때 첫 버튼으로 포커스 (H.16) */
  autoFocus?: boolean;
  /** 문단 아래·버튼 위에 넣을 내용 (예: Part 3 도구 후보 목록) */
  children?: ReactNode;
}

/**
 * 범용 확인 카드 (T-100 H.8·H.16 — Part 2·3 카드도 같은 틀)
 *  - 제목·배지 / 쉬운 말 문단 / 버튼(①②③, 숫자 키 1·2·3…) / 체크 상자 / 자세히 보기(기본 접힘)
 *  - 기술 정보는 펼치기 전에는 DOM에 그리지 않는다
 */
export function ActionCard({ card, onChoose, busy, error, autoFocus, children }: ActionCardProps) {
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus) first.current?.focus();
  }, [autoFocus]);

  const choose = (id: string) => {
    if (!busy) onChoose?.(id, { checked });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' && (e.target as HTMLInputElement).type === 'text') return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1) return;
    const b = card.buttons[n - 1];
    if (!b) return;
    e.preventDefault();
    choose(b.id);
  };

  return (
    <article
      className="hx-action-card"
      role="group"
      aria-label={`${card.title}${card.badges?.length ? ` ${card.badges.join(' ')}` : ''}`}
      data-card-id={card.id}
      onKeyDown={onKeyDown}
    >
      <header className="hx-action-card__head">
        <strong>
          <span aria-hidden="true">{`${card.icon ?? '✋'} `}</span>
          {card.title}
        </strong>
        {card.badges?.map((b) => (
          <span key={b} className="hx-action-card__badge">
            {b}
          </span>
        ))}
      </header>
      {card.sections.map((s, i) => (
        <section key={i} className="hx-action-card__section">
          {s.heading && <h4>{s.heading}</h4>}
          <p>{s.text}</p>
        </section>
      ))}
      {children}
      <div className="hx-action-card__buttons">
        {card.buttons.map((b, i) => (
          <button
            key={b.id}
            ref={i === 0 ? first : undefined}
            type="button"
            className={`hx-action-card__btn${b.primary ? ' hx-action-card__btn--primary' : ''}`}
            data-choice={b.id}
            aria-keyshortcuts={String(i + 1)}
            disabled={busy || !onChoose}
            onClick={() => choose(b.id)}
          >
            <span className="hx-action-card__key" aria-hidden="true">
              {String.fromCodePoint(0x2460 + i)}
            </span>{' '}
            {b.label}
          </button>
        ))}
      </div>
      {card.checkbox && (
        <label className="hx-action-card__check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />{' '}
          {card.checkbox}
        </label>
      )}
      {card.technical && card.technical.length > 0 && (
        <div className="hx-action-card__tech">
          <button
            type="button"
            className="hx-action-card__more"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '▾' : '▸'} 자세히 보기 (기술 정보)
          </button>
          {open && (
            <dl data-testid="action-card-technical">
              {card.technical.map((t) => (
                <div key={t.label}>
                  <dt>{t.label}</dt>
                  <dd className="hx-mono">{t.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
      {error && (
        <p className="hx-action-card__error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
