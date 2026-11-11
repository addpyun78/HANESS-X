import type { RunMode } from '@harness-x/protocol';
import './run-mode.css';

/**
 * T-101 3B.2 계획 완료 카드 (계획 모드에서 체크리스트를 만든 뒤)
 * [이 계획대로 실행(일반)] [오토로 실행] [계획 고치기]
 */

export type PlanDoneChoice = 'run-normal' | 'run-auto' | 'revise';

export interface PlanDoneAction {
  /** 계획을 확정(Lock)하고 실행하나 */
  approve: boolean;
  /** 다음 모드 */
  mode: RunMode;
  /** 계획 고치기: 입력창에 채울 글 */
  fill?: string;
}

export const PLAN_DONE_LABEL: Readonly<Record<PlanDoneChoice, string>> = Object.freeze({
  'run-normal': '이 계획대로 실행(일반)',
  'run-auto': '오토로 실행',
  revise: '계획 고치기',
});

export const REVISE_FILL = '계획을 이렇게 고쳐 주세요: ';

export function planDoneAction(choice: PlanDoneChoice): PlanDoneAction {
  switch (choice) {
    case 'run-normal':
      return { approve: true, mode: 'normal' };
    case 'run-auto':
      return { approve: true, mode: 'auto' };
    case 'revise':
      return { approve: false, mode: 'plan', fill: REVISE_FILL };
  }
}

export interface PlanDoneCardProps {
  /** 계획 항목 수 */
  itemCount: number;
  onChoose: (action: PlanDoneAction, choice: PlanDoneChoice) => void;
  busy?: boolean;
}

export function PlanDoneCard({ itemCount, onChoose, busy }: PlanDoneCardProps) {
  const btn = (c: PlanDoneChoice, primary = false) => (
    <button
      type="button"
      className={`hx-ck-btn${primary ? ' hx-ck-btn--primary' : ''}`}
      data-choice={c}
      disabled={busy}
      onClick={() => onChoose(planDoneAction(c), c)}
    >
      {PLAN_DONE_LABEL[c]}
    </button>
  );
  return (
    <section className="hx-plan-done" role="group" aria-label="계획 완료">
      <p className="hx-plan-done__title">
        <strong>계획을 다 만들었어요.</strong> 할 일 {itemCount}개를 확인해 주세요.
      </p>
      <div className="hx-plan-done__actions">
        {btn('run-normal', true)}
        {btn('run-auto')}
        {btn('revise')}
      </div>
    </section>
  );
}
