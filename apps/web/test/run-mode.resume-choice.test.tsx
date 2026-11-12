// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunMode } from '@harness-x/protocol';
import { keptMode, ResumeModeChoice } from '../src/run-mode/ResumeModeChoice.js';

afterEach(cleanup);

function Harness({ sessionMode, onPick }: { sessionMode?: string; onPick: (m: RunMode) => void }) {
  const [v, setV] = useState<RunMode>();
  return (
    <ResumeModeChoice
      {...(sessionMode ? { sessionMode } : {})}
      {...(v ? { value: v } : {})}
      onChange={(m) => {
        setV(m);
        onPick(m);
      }}
    />
  );
}

// T-101 3E.6 이어하기 카드의 모드 고르기: 기본은 유지, 바꿀 수 있음
describe('3E.6 이어하기 모드 고르기', () => {
  it('멈추기 전 모드가 기본으로 보이고 "(멈추기 전 모드)" 표시', () => {
    render(<Harness sessionMode="auto" onPick={() => {}} />);
    fireEvent.click(screen.getByLabelText('모드: 오토'));
    const auto = screen.getByRole('menuitemradio', { name: /^오토/ });
    expect(auto.getAttribute('aria-checked')).toBe('true');
    expect(auto.textContent).toContain('(멈추기 전 모드)');
  });

  it('바꾸면 그 모드', () => {
    const onPick = vi.fn();
    render(<Harness sessionMode="auto" onPick={onPick} />);
    fireEvent.click(screen.getByLabelText('모드: 오토'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^일반/ }));
    expect(onPick).toHaveBeenCalledWith('normal');
    expect(screen.getByLabelText('모드: 일반')).toBeTruthy();
  });

  it('기록이 없으면 일반', () => {
    expect(keptMode(undefined)).toBe('normal');
    expect(keptMode('plan')).toBe('plan');
  });
});
