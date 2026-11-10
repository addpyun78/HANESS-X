// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResumeCard, type ResumeCardData } from '../src/recovery/ResumeCard.js';

afterEach(cleanup);

const card: ResumeCardData = {
  sessionId: 's9',
  engineId: 'claude-code',
  lastEventAt: '2026-11-11T00:00:00.000Z',
  remaining: 3,
  nextItemId: '2',
  nextItemTitle: '항목 2 구현',
};

describe('"이어서 하기" 카드 (T-061)', () => {
  it('남은 항목·다음 항목을 보이고, 버튼을 누르면 세션 id로 재개를 요청한다', async () => {
    const onResume = vi.fn(async () => {});
    render(<ResumeCard card={card} onResume={onResume} />);
    expect(screen.getByRole('region', { name: '이어서 하기' })).toBeTruthy();
    expect(screen.getByTestId('resume-remaining').textContent).toBe('남은 항목 3개');
    expect(screen.getByTestId('resume-next').textContent).toBe('다음 항목: 2 항목 2 구현');
    fireEvent.click(screen.getByRole('button', { name: '이어서 하기' }));
    expect(onResume).toHaveBeenCalledWith('s9');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '재개됨' })).toHaveProperty('disabled', true),
    );
  });

  it('재개 실패 시 오류를 알리고 다시 누를 수 있다', async () => {
    const onResume = vi.fn(async () => {
      throw new Error('500');
    });
    render(<ResumeCard card={{ ...card, remaining: null, nextItemId: null }} onResume={onResume} />);
    expect(screen.queryByTestId('resume-next')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '이어서 하기' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('재개하지 못했습니다'));
    expect(screen.getByRole('button', { name: '이어서 하기' })).toHaveProperty('disabled', false);
  });
});
