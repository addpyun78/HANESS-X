import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { act } from '../actions/registry.js';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ChipMenuProps<T extends string> {
  /** 칩 종류 이름 (접근성 라벨) */
  name: string;
  icon?: ReactNode;
  value: T;
  valueLabel: string;
  options: ChipOption<T>[];
  onChange: (v: T) => void;
  className?: string;
  emptyText?: string;
  /** T-101 3A.4 잠금: 자물쇠를 보이고 펼치지 않는다 (값 = 이유, 쉬운 말) */
  locked?: string;
}

/** 입력창 아래 칩 + 클릭 시 위로 뜨는 팝오버 목록 */
export function ChipMenu<T extends string>({
  name,
  icon,
  value,
  valueLabel,
  options,
  onChange,
  className = '',
  emptyText = '선택할 항목이 없습니다',
  locked,
}: ChipMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`hx-chip-wrap ${className}`} ref={ref}>
      <button
        {...act('composer.chip')}
        type="button"
        className="hx-chip"
        aria-label={`${name}: ${valueLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        {...(locked
          ? { 'aria-disabled': true, title: locked, 'aria-description': locked, 'data-locked': '' }
          : {})}
        onClick={() => !locked && setOpen(!open)}
      >
        {icon && <span aria-hidden="true">{icon}</span>}
        <span>{valueLabel}</span>
        <span className="hx-chip__caret" aria-hidden="true">
          {locked ? '🔒' : '▾'}
        </span>
      </button>
      {open && !locked && (
        <div className="hx-popover" role="menu" id={menuId} aria-label={name}>
          {options.length === 0 && <p className="hx-popover__empty">{emptyText}</p>}
          {options.map((o) => (
            <button
              {...act('composer.chip-option')}
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              disabled={o.disabled}
              title={o.disabled ? '지금은 고를 수 없어요' : undefined}
              className="hx-popover__item"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="hx-popover__check" aria-hidden="true">
                {o.value === value ? '✓' : ''}
              </span>
              <span className="hx-popover__label">{o.label}</span>
              {o.description && <span className="hx-popover__desc">{o.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
