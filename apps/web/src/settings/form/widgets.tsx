import { useEffect, useState, type KeyboardEvent } from 'react';
import type { SettingField } from './types.js';

/**
 * T-101 0A.5 기본 위젯 5종 — 켜기/끄기(boolean), 선택(enum), 숫자(입력+범위), 글자(string), 목록(array).
 * 값은 바뀌는 즉시(켜기·선택·목록) 또는 칸을 벗어나거나 Enter를 누를 때(숫자·글자) onCommit으로 저장한다.
 */

export interface WidgetProps {
  field: SettingField;
  value: unknown;
  onCommit: (value: unknown) => void;
  disabled?: boolean;
  /** 라벨과 잇는 입력 id */
  inputId: string;
  /** 글자 칸의 제안 목록(datalist) id */
  listId?: string;
}

const enterCommits = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
};

export function BooleanWidget({ field, value, onCommit, disabled, inputId }: WidgetProps) {
  const on = value === true;
  return (
    <button
      id={inputId}
      type="button"
      role="switch"
      aria-checked={on}
      className="hx-setting__switch"
      data-action="settings.toggle"
      disabled={disabled}
      onClick={() => onCommit(!on)}
      title={field.title}
    >
      <span className="hx-setting__switch-knob" aria-hidden="true" />
      <span className="hx-setting__switch-label">{on ? '켜짐' : '꺼짐'}</span>
    </button>
  );
}

export function enumValues(field: SettingField): string[] {
  const e = field.schema.enum ?? field.schema.items?.enum ?? [];
  return e.map(String);
}

export function EnumWidget({ field, value, onCommit, disabled, inputId }: WidgetProps) {
  const vals = enumValues(field);
  return (
    <select
      id={inputId}
      className="hx-setting__select"
      value={value === undefined || value === null ? '' : String(value)}
      disabled={disabled}
      onChange={(e) => onCommit(e.currentTarget.value)}
    >
      {vals.map((v) => (
        <option key={v} value={v}>
          {field.options?.[v] ?? v}
        </option>
      ))}
    </select>
  );
}

/** 범위 안내 글 ("1~3", "0 이상") */
export function rangeText(field: SettingField): string | undefined {
  const { minimum: min, maximum: max } = field.schema;
  if (min !== undefined && max !== undefined) return `${min}~${max}`;
  if (min !== undefined) return `${min} 이상`;
  if (max !== undefined) return `${max} 이하`;
  return undefined;
}

export function NumberWidget({ field, value, onCommit, disabled, inputId }: WidgetProps) {
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  useEffect(() => setText(value === undefined || value === null ? '' : String(value)), [value]);
  const range = rangeText(field);
  const isInt = field.schema.type === 'integer';
  return (
    <span className="hx-setting__number">
      <input
        id={inputId}
        type="number"
        inputMode={isInt ? 'numeric' : 'decimal'}
        className="hx-setting__input hx-setting__input--number"
        value={text}
        {...(field.schema.minimum !== undefined ? { min: field.schema.minimum } : {})}
        {...(field.schema.maximum !== undefined ? { max: field.schema.maximum } : {})}
        step={isInt ? 1 : 'any'}
        disabled={disabled}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={enterCommits}
        onBlur={() => {
          if (text === String(value ?? '')) return;
          const n = Number(text);
          // 숫자가 아니면 그대로 보내 서버가 쉬운 말로 거부하게 한다
          onCommit(text.trim() === '' || Number.isNaN(n) ? text : n);
        }}
      />
      {range && <span className="hx-setting__range">{range}</span>}
    </span>
  );
}

export function StringWidget({ field, value, onCommit, disabled, inputId, listId }: WidgetProps) {
  const [text, setText] = useState(typeof value === 'string' ? value : '');
  useEffect(() => setText(typeof value === 'string' ? value : ''), [value]);
  return (
    <input
      id={inputId}
      type="text"
      className="hx-setting__input"
      list={listId}
      value={text}
      placeholder={field.default === '' ? '비워 두면 기본값' : undefined}
      disabled={disabled}
      onChange={(e) => setText(e.currentTarget.value)}
      onKeyDown={enterCommits}
      onBlur={() => {
        if (text !== (typeof value === 'string' ? value : '')) onCommit(text);
      }}
    />
  );
}

export function ArrayWidget({ field, value, onCommit, disabled, inputId }: WidgetProps) {
  const items = Array.isArray(value) ? value.map(String) : [];
  const [draft, setDraft] = useState('');
  const numeric = ['number', 'integer'].includes(String(field.schema.items?.type));
  const conv = (s: string): unknown =>
    numeric && s.trim() !== '' && !Number.isNaN(Number(s)) ? Number(s) : s;
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onCommit([...items.map(conv), conv(v)]);
    setDraft('');
  };
  return (
    <div className="hx-setting__list">
      <ul className="hx-setting__list-items">
        {items.map((it, i) => (
          <li key={`${i}:${it}`} className="hx-setting__list-item">
            <span>{it}</span>
            <button
              type="button"
              className="hx-setting__link"
              data-action="settings.list-remove"
              disabled={disabled}
              title={disabled ? '지금은 바꿀 수 없어요' : undefined}
              aria-label={`${it} 빼기`}
              onClick={() => onCommit(items.filter((_x, j) => j !== i).map(conv))}
            >
              빼기
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="hx-setting__list-empty">비어 있어요</li>}
      </ul>
      <span className="hx-setting__list-add">
        <input
          id={inputId}
          type="text"
          className="hx-setting__input"
          value={draft}
          placeholder="새 항목"
          disabled={disabled}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) add();
          }}
        />
        <button
          type="button"
          data-action="settings.list-add"
          disabled={disabled}
          title={disabled ? '지금은 바꿀 수 없어요' : undefined}
          onClick={add}
        >
          추가
        </button>
      </span>
    </div>
  );
}

export const BASIC_WIDGETS = {
  boolean: BooleanWidget,
  enum: EnumWidget,
  number: NumberWidget,
  string: StringWidget,
  array: ArrayWidget,
} as const;
