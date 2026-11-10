import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

export interface ResizerProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** 'left'면 오른쪽으로 끌 때 커지고, 'right'면 왼쪽으로 끌 때 커진다 */
  side: 'left' | 'right';
  onChange: (w: number) => void;
  /** 끌기가 끝났을 때(저장 시점) */
  onCommit: (w: number) => void;
}

const STEP = 16;

/** 열 경계 드래그 리사이즈 (마우스 + 키보드 ←/→) */
export function Resizer({ label, value, min, max, side, onChange, onCommit }: ResizerProps) {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(value);
  latest.current = value;
  const clampW = (w: number) => Math.round(Math.min(max, Math.max(min, w)));

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = value;
    setDragging(true);
    const move = (ev: globalThis.MouseEvent) => {
      const dx = ev.clientX - startX;
      const w = clampW(side === 'left' ? startW + dx : startW - dx);
      latest.current = w;
      onChange(w);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDragging(false);
      onCommit(latest.current);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const grow = (e.key === 'ArrowRight') === (side === 'left');
    const w = clampW(value + (grow ? STEP : -STEP));
    onChange(w);
    onCommit(w);
  };

  return (
    <div
      className="hx-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-dragging={dragging}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
    />
  );
}
