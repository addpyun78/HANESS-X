import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

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
        type="button"
        className="hx-chip"
        aria-label={`${name}: ${valueLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        {icon && <span aria-hidden="true">{icon}</span>}
        <span>{valueLabel}</span>
        <span className="hx-chip__caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="hx-popover" role="menu" id={menuId} aria-label={name}>
          {options.length === 0 && <p className="hx-popover__empty">{emptyText}</p>}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              disabled={o.disabled}
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
