import { useEffect, useRef, useState } from 'react';
import { act } from '../actions/registry.js';

/** T-101 2A.8 실행 중 정지 조작 (Composer의 stop prop) */
export interface StopControls {
  /** 이 세션이 실행 중이면 전송 버튼 자리가 [■ 정지]로 바뀐다 */
  running: boolean;
  /** ⏸ 일시정지 (안전한 지점에서 멈춤) → POST /api/sessions/:id/pause */
  onPause(): void;
  /** ⏹ 지금 멈추기 → POST /api/sessions/:id/stop */
  onStopNow(): void;
}

/** Esc를 이 시간 안에 두 번 누르면 지금 멈추기 */
export const ESC_TWICE_MS = 800;

/**
 * Esc 두 번 = 지금 멈추기. 입력 중 한글 조합(IME)의 Esc는 세지 않는다.
 * active가 false면 듣지 않는다.
 */
export function useEscTwice(active: boolean, onTwice: () => void, windowMs = ESC_TWICE_MS): void {
  const last = useRef(0);
  const cb = useRef(onTwice);
  cb.current = onTwice;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      const now = Date.now();
      if (now - last.current <= windowMs) {
        last.current = 0;
        cb.current();
      } else last.current = now;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, windowMs]);
}

/** [■ 정지] → 누르면 [일시정지] [지금 멈추기] */
export function StopButton({ onPause, onStopNow }: Omit<StopControls, 'running'>) {
  const [open, setOpen] = useState(false);
  useEscTwice(true, () => {
    setOpen(false);
    onStopNow();
  });
  return (
    <span className="hx-stop">
      <button
        type="button"
        className="hx-send hx-send--stop"
        aria-label="정지"
        aria-haspopup="menu"
        aria-expanded={open}
        {...act('composer.stop')}
        onClick={() => setOpen((o) => !o)}
      >
        ■ 정지
      </button>
      {open && (
        <span className="hx-stop__menu" role="menu" aria-label="정지 방법">
          <button
            type="button"
            role="menuitem"
            title="하던 일을 마무리하기 좋은 때에 멈춰요"
            {...act('composer.stop-pause')}
            onClick={() => {
              setOpen(false);
              onPause();
            }}
          >
            ⏸ 일시정지
          </button>
          <button
            type="button"
            role="menuitem"
            title="바로 멈춰요 (Esc 두 번)"
            {...act('composer.stop-now')}
            onClick={() => {
              setOpen(false);
              onStopNow();
            }}
          >
            ⏹ 지금 멈추기
          </button>
        </span>
      )}
    </span>
  );
}
