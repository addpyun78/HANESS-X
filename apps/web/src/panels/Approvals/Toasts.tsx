import { useEffect } from 'react';
import type { Toast } from './useApprovals.js';
import './approvals.css';
import { act } from '../../actions/registry.js';

export interface ToastsProps {
  toasts: readonly Toast[];
  onOpen?: (cardId: string) => void;
  onDismiss: (id: string) => void;
  /** 자동으로 사라지기까지 (기본 8초) */
  timeoutMs?: number;
}

/** 새 승인 카드 토스트 (T-100 H.12) — 누르면 패널의 그 카드로. 안내(notice, J.6) 토스트는 누르면 닫힌다 */
export function Toasts({ toasts, onOpen, onDismiss, timeoutMs = 8000 }: ToastsProps) {
  useEffect(() => {
    if (toasts.length === 0) return;
    const ts = toasts.map((t) => setTimeout(() => onDismiss(t.id), timeoutMs));
    return () => ts.forEach(clearTimeout);
  }, [toasts, onDismiss, timeoutMs]);
  if (toasts.length === 0) return null;
  return (
    <div className="hx-toasts" role="status" aria-live="polite" aria-label="알림">
      {toasts.map((t) => (
        <button
          {...act('approvals.toast')}
          key={t.id}
          type="button"
          className="hx-toast"
          onClick={() => {
            if (t.cardId) onOpen?.(t.cardId);
            onDismiss(t.id);
          }}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
