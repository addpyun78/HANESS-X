import { describeLimits, normalizeLimits, type AutoLimits } from '@harness-x/protocol';
import { useState } from 'react';
import './run-mode.css';

/**
 * T-101 3D.5 오토 시작 카드: 상한(시간·토큰·비용·반복)을 쉬운 말로 보여주고, 시작 전에 바꿀 수 있다.
 * 상한은 필수 — 빈 칸·0 이하는 기본값으로 돌아간다(비용은 0 = 비용으로는 안 멈춤).
 */

export interface AutoLimitsCardProps {
  limits: AutoLimits;
  onStart: (limits: AutoLimits) => void;
  onCancel?: () => void;
}

const FIELDS: { key: keyof AutoLimits; label: string; step?: number }[] = [
  { key: 'maxMinutes', label: '최대 시간(분)' },
  { key: 'maxTokens', label: '최대 토큰', step: 1000 },
  { key: 'maxCostUsd', label: '최대 비용(달러)', step: 0.5 },
  { key: 'maxIterations', label: '최대 반복 수' },
];

export function AutoLimitsCard({ limits, onStart, onCancel }: AutoLimitsCardProps) {
  const [draft, setDraft] = useState<AutoLimits>(limits);
  const [editing, setEditing] = useState(false);
  const shown = normalizeLimits(draft);
  return (
    <section className="hx-auto-limits" role="group" aria-label="오토 모드 상한">
      <p className="hx-auto-limits__title">
        <strong>오토 모드로 시작해요.</strong> 아래 한도를 넘으면 멈추고 기다려요.
      </p>
      <ul className="hx-auto-limits__lines" data-testid="auto-limit-lines">
        {describeLimits(shown).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {editing && (
        <div className="hx-auto-limits__edit">
          {FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type="number"
                min={0}
                step={f.step ?? 1}
                value={draft[f.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))}
              />
            </label>
          ))}
        </div>
      )}
      <div className="hx-auto-limits__actions">
        <button type="button" className="hx-ck-btn hx-ck-btn--primary" onClick={() => onStart(shown)}>
          이 한도로 시작
        </button>
        {!editing && (
          <button type="button" className="hx-ck-btn" onClick={() => setEditing(true)}>
            한도 바꾸기
          </button>
        )}
        {onCancel && (
          <button type="button" className="hx-ck-btn" onClick={onCancel}>
            취소
          </button>
        )}
      </div>
    </section>
  );
}
