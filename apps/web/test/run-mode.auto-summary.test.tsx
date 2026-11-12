// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotifierLike } from '../src/panels/Approvals/useApprovals.js';
import { AUTO_SUMMARY_TITLE, AutoSummaryCard, summaryLine } from '../src/run-mode/AutoSummaryCard.js';
import { checkPlainKorean } from './plain-check.js';

afterEach(cleanup);

function notifier(permission: NotificationPermission = 'granted') {
  return { permission, requestPermission: vi.fn(), show: vi.fn() } satisfies NotifierLike;
}

// T-101 3D.8 오토 종료 요약 카드: 한 일 / 못 한 일 / 확인할 것 개수 + OS 알림
describe('3D.8 오토 종료 요약', () => {
  it('개수 3가지 + OS 알림 1번 (스냅샷)', () => {
    const n = notifier();
    const onOpenReview = vi.fn();
    const summary = { done: 7, notDone: 2, review: 3, ended: 'finished' as const };
    const { container, rerender } = render(
      <AutoSummaryCard summary={summary} notifier={n} onOpenReview={onOpenReview} />,
    );
    expect(screen.getByTestId('auto-done').textContent).toBe('7');
    expect(screen.getByTestId('auto-not-done').textContent).toBe('2');
    expect(screen.getByTestId('auto-review').textContent).toBe('3');
    expect(container.innerHTML).toMatchSnapshot();
    expect(n.show).toHaveBeenCalledOnce();
    expect(n.show).toHaveBeenCalledWith(
      '오토 실행이 끝났어요',
      '한 일 7개 · 못 한 일 2개 · 확인할 것 3개',
      expect.any(Function),
    );
    rerender(<AutoSummaryCard summary={summary} notifier={n} onOpenReview={onOpenReview} />);
    expect(n.show).toHaveBeenCalledOnce();
    // 알림 클릭 → 확인 목록 열기
    n.show.mock.calls[0]![2]();
    fireEvent.click(screen.getByRole('button', { name: '확인할 것 보기' }));
    expect(onOpenReview).toHaveBeenCalledTimes(2);
  });

  it('알림 허락이 없으면 알림 없이 카드만', () => {
    const n = notifier('default');
    render(<AutoSummaryCard summary={{ done: 1, notDone: 0, review: 0, ended: 'paused' }} notifier={n} />);
    expect(n.show).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('오토 실행을 멈췄어요');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('쉬운 말', () => {
    for (const t of Object.values(AUTO_SUMMARY_TITLE)) expect(checkPlainKorean(t).ok, t).toBe(true);
    const line = summaryLine({ done: 1, notDone: 1, review: 1, ended: 'finished' });
    expect(checkPlainKorean(line, { label: true }).ok, line).toBe(true);
  });
});
