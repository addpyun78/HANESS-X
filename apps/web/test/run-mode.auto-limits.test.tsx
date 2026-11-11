// @vitest-environment jsdom
import { DEFAULT_AUTO_LIMITS } from '@harness-x/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoLimitsCard } from '../src/run-mode/AutoLimitsCard.js';
import { checkPlainKorean } from './plain-check.js';

afterEach(cleanup);

// T-101 3D.5 오토 시작 시 상한을 쉬운 말로 보여주고 바꿀 수 있음
describe('3D.5 오토 상한 카드', () => {
  it('쉬운 말 4줄 + 그대로 시작', () => {
    const onStart = vi.fn();
    render(<AutoLimitsCard limits={DEFAULT_AUTO_LIMITS} onStart={onStart} />);
    const lines = [...screen.getByTestId('auto-limit-lines').querySelectorAll('li')].map(
      (l) => l.textContent!,
    );
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('최대 60분 동안 일해요.');
    for (const l of lines) expect(checkPlainKorean(l).ok, l).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '이 한도로 시작' }));
    expect(onStart).toHaveBeenCalledWith(DEFAULT_AUTO_LIMITS);
  });

  it('한도 바꾸기 → 고친 값으로 시작, 0을 넣으면 기본값 (상한 필수)', () => {
    const onStart = vi.fn();
    render(<AutoLimitsCard limits={DEFAULT_AUTO_LIMITS} onStart={onStart} />);
    fireEvent.click(screen.getByRole('button', { name: '한도 바꾸기' }));
    fireEvent.change(screen.getByLabelText('최대 시간(분)'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('최대 반복 수'), { target: { value: '0' } });
    expect(screen.getByTestId('auto-limit-lines').textContent).toContain('최대 15분');
    fireEvent.click(screen.getByRole('button', { name: '이 한도로 시작' }));
    expect(onStart).toHaveBeenCalledWith({ ...DEFAULT_AUTO_LIMITS, maxMinutes: 15 });
  });
});
