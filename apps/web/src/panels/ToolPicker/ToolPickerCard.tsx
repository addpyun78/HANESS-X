import { useState, type ReactNode } from 'react';
import { ActionCard } from '../Approvals/ActionCard.js';
import type { ActionCardModel } from '../Approvals/model.js';
import {
  initialSelection,
  PICKER_BUTTONS,
  PREVIOUS_CHOICE_LABEL,
  pricingBadge,
  RECOMMENDED_LABEL,
  requiredByText,
  TOOL_PICKER_TITLE,
  type PickerButtonId,
  type PickerCandidateData,
  type ToolPickerData,
} from './model.js';
import './toolpicker.css';

export interface ToolPickerCardProps {
  data: ToolPickerData;
  /** [선택한 걸로 설치] — 고른 후보(화면 순서)마다 Part 2 계획 카드를 순서대로 띄운다 */
  onInstallSelected?: (candidates: PickerCandidateData[]) => void;
  /** [주소 직접 넣기] — Part 2 C(주소로 설치) 화면으로 */
  onOpenUrlInstall?: () => void;
  /** [설치 없이 계속] */
  onContinueWithout?: () => void;
  busy?: boolean;
  error?: string;
  autoFocus?: boolean;
}

export const NOTHING_SELECTED = '먼저 설치할 도구를 골라 주세요.';

/** 무료/유료 배지 (Part 2 D.2와 같은 색). 등급이 없으면 렌더 오류 */
export function PricingBadge({ name, tier }: { name: string; tier: unknown }) {
  const b = pricingBadge(name, tier);
  return (
    <span className={`hx-price-badge hx-price-badge--${b.tone}`} data-tone={b.tone}>
      [{b.label}]
    </span>
  );
}

function CandidateRow({
  c,
  checked,
  onToggle,
}: {
  c: PickerCandidateData;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <li className="hx-tool-cand" data-candidate-id={c.id} data-recommended={c.recommended || undefined}>
      {c.previous && <p className="hx-tool-cand__previous">{PREVIOUS_CHOICE_LABEL}</p>}
      <label className="hx-tool-cand__head">
        <input
          type="checkbox"
          checked={checked}
          aria-label={`${c.name} 고르기`}
          onChange={(e) => onToggle(e.target.checked)}
        />
        {c.recommended && (
          <span className="hx-tool-cand__star" aria-label={RECOMMENDED_LABEL}>
            ⭐ {RECOMMENDED_LABEL}
          </span>
        )}
        <strong className="hx-tool-cand__name">{c.name}</strong>
        <PricingBadge name={c.name} tier={c.pricing.tier} />
        {c.pricing.tier !== 'free' && c.pricing.note && (
          <span className="hx-tool-cand__note">{c.pricing.note}</span>
        )}
      </label>
      {c.summary && <p className="hx-tool-cand__summary">{c.summary}</p>}
      <p className="hx-tool-cand__why">
        <span className="hx-tool-cand__label">왜 추천하나요?</span> {c.reason}
      </p>
      <p className="hx-tool-cand__con">
        <span className="hx-tool-cand__label">아쉬운 점:</span> {c.con}
      </p>
      <p className="hx-tool-cand__install">
        설치: {c.installLabel} ·{' '}
        <a href={c.pricing.sourceUrl} target="_blank" rel="noreferrer noopener">
          출처 링크
        </a>{' '}
        · <time dateTime={c.pricing.checkedAt}>{c.checkedLabel}</time>
      </p>
    </li>
  );
}

/** P3-C.8 승인 카드 영역(ApprovalsArea extraCards)에 넣을 항목들 */
export function toolPickerExtraCards(
  cards: readonly ToolPickerData[],
  handlers: (card: ToolPickerData) => Omit<ToolPickerCardProps, 'data'>,
): { id: string; node: ReactNode }[] {
  return cards.map((d) => ({ id: d.id, node: <ToolPickerCard key={d.id} data={d} {...handlers(d)} /> }));
}

/**
 * "도구 고르기" 카드 (T-100 P3-C.3·C.4·C.5)
 *  - 범용 ActionCard 틀(Part 1 승인 카드와 같은 컴포넌트) 안에 후보 목록
 *  - 후보마다 이름·무료/유료 배지(필수)·한 줄 설명·추천 이유·아쉬운 점·설치 방법·출처 링크·확인 날짜, 추천 1개에 ⭐
 *  - 여러 개 고를 수 있다 (처음엔 추천만 골라 둔다)
 */
export function ToolPickerCard({
  data,
  onInstallSelected,
  onOpenUrlInstall,
  onContinueWithout,
  busy,
  error,
  autoFocus,
}: ToolPickerCardProps) {
  // 배지 없는 후보가 하나라도 있으면 카드 전체를 그리지 않는다 (렌더 오류)
  for (const c of data.candidates) pricingBadge(c.name, c.pricing?.tier);
  const [selected, setSelected] = useState<string[]>(() => initialSelection(data));
  const [localError, setLocalError] = useState<string>();

  const model: ActionCardModel = {
    id: data.id,
    icon: '🔧',
    title: TOOL_PICKER_TITLE,
    sections: [
      { heading: '필요한 것', text: `${data.need.capability}${requiredByText(data.need.requiredBy)}` },
      ...data.notices.map((n) => ({ text: n })),
    ],
    buttons: PICKER_BUTTONS.map((b) => ({ ...b })),
  };

  const choose = (id: string) => {
    const b = id as PickerButtonId;
    if (b === 'install') {
      const chosen = data.candidates.filter((c) => selected.includes(c.id));
      if (chosen.length === 0) return setLocalError(NOTHING_SELECTED);
      setLocalError(undefined);
      onInstallSelected?.(chosen);
    } else if (b === 'url') onOpenUrlInstall?.();
    else onContinueWithout?.();
  };

  const err = error ?? localError;
  return (
    <ActionCard
      card={model}
      onChoose={choose}
      {...(busy ? { busy } : {})}
      {...(err ? { error: err } : {})}
      {...(autoFocus ? { autoFocus } : {})}
    >
      <ul className="hx-tool-cands" aria-label="도구 후보">
        {data.candidates.map((c) => (
          <CandidateRow
            key={c.id}
            c={c}
            checked={selected.includes(c.id)}
            onToggle={(v) =>
              setSelected((cur) =>
                v ? [...cur.filter((x) => x !== c.id), c.id] : cur.filter((x) => x !== c.id),
              )
            }
          />
        ))}
      </ul>
    </ActionCard>
  );
}
