import { useEffect, useRef } from 'react';
import { act } from '../../actions/registry.js';

export interface ConfirmCardProps {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 0B.28/0B.29 확인 카드 (목록에서 빼기·삭제) */
export function ConfirmCard({ title, body, confirmLabel, onConfirm, onCancel }: ConfirmCardProps) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  return (
    <div
      className="hx-confirm"
      role="alertdialog"
      aria-label={title}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <p className="hx-confirm__title">{title}</p>
      <p className="hx-confirm__body">{body}</p>
      <div className="hx-confirm__actions">
        <button {...act('confirm.ok')} ref={ok} type="button" className="hx-confirm__ok" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button {...act('confirm.cancel')} type="button" onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
