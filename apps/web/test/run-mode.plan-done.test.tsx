// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanDoneCard, planDoneAction, REVISE_FILL } from '../src/run-mode/PlanDoneCard.js';
import { checkPlainKorean } from './plain-check.js';

afterEach(cleanup);

// T-101 3B.2 계획 완료 카드: [이 계획대로 실행(일반)] [오토로 실행] [계획 고치기] — 3경로
describe('3B.2 계획 완료 카드', () => {
  it('버튼 3개, 쉬운 말', () => {
    render(<PlanDoneCard itemCount={4} onChoose={() => {}} />);
    const card = screen.getByRole('group', { name: '계획 완료' });
    const labels = [...card.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(labels).toEqual(['이 계획대로 실행(일반)', '오토로 실행', '계획 고치기']);
    for (const t of labels) expect(checkPlainKorean(t, { label: true }).ok, t).toBe(true);
    expect(checkPlainKorean(card.querySelector('p')!.textContent!).ok).toBe(true);
  });

  it.each([
    ['이 계획대로 실행(일반)', { approve: true, mode: 'normal' }],
    ['오토로 실행', { approve: true, mode: 'auto' }],
    ['계획 고치기', { approve: false, mode: 'plan', fill: REVISE_FILL }],
  ])('%s', (label, want) => {
    const onChoose = vi.fn();
    render(<PlanDoneCard itemCount={2} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(onChoose).toHaveBeenCalledOnce();
    expect(onChoose.mock.calls[0]![0]).toEqual(want);
  });

  it('계획 고치기는 확정하지 않고 계획 모드에 남는다', () => {
    expect(planDoneAction('revise').approve).toBe(false);
    expect(planDoneAction('run-auto').approve).toBe(true);
  });
});
