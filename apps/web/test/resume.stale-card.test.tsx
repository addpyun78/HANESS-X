// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBeforeResume, staleIssue } from '../../../packages/kernel/src/resume-check.js';
import { ResumeCheckCard } from '../src/recovery/ResumeCheckCard.js';
import { checkPlainKorean } from './plain-check.js';

afterEach(cleanup);

const DONE = [
  { id: 'I-1', title: '로그인 화면 만들기' },
  { id: 'I-2', title: '비밀번호 찾기 버튼 달기' },
];

describe('2B.7 멈춘 지 7일 이상 → 지금까지 한 일 요약 확인 카드', () => {
  it('끝낸 항목 기준 쉬운 말 요약 (스냅샷), [이어서 하기]', () => {
    const r = checkBeforeResume(
      {
        sessionId: 's1',
        projectId: 'p1',
        title: '/qa 로그인',
        agent: null,
        engineId: null,
        progress: 0.4,
        paused: { reason: 'user', at: '2026-11-01T09:00:00.000Z', by: 'user' },
        startedAt: null,
      },
      { now: new Date('2026-11-12T09:00:00.000Z'), doneItems: () => DONE },
    );
    expect(r.issues).toHaveLength(1);
    const issue = r.issues[0]!;
    const onChoose = vi.fn();
    const { container } = render(<ResumeCheckCard issue={issue} onChoose={onChoose} />);
    expect(screen.getByText('멈춘 지 오래됐어요')).toBeTruthy();
    expect(
      screen.getByText('멈춘 지 11일이 지났어요. 지금까지 2개를 끝냈어요. 이대로 이어할까요?'),
    ).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      '끝냄: 로그인 화면 만들기',
      '끝냄: 비밀번호 찾기 버튼 달기',
    ]);
    expect(container.innerHTML).toMatchInlineSnapshot(
      `"<section class="hx-resume hx-resume-check" aria-label="멈춘 지 오래됐어요" data-check="stale"><div class="hx-resume__head"><span aria-hidden="true">ℹ</span><strong>멈춘 지 오래됐어요</strong></div><p class="hx-resume__body">멈춘 지 11일이 지났어요. 지금까지 2개를 끝냈어요. 이대로 이어할까요?</p><ul class="hx-resume-check__list"><li>끝냄: 로그인 화면 만들기</li><li>끝냄: 비밀번호 찾기 버튼 달기</li></ul><div class="hx-resume-check__choices"><button type="button" data-action="resume.check-choice" class="hx-resume__button hx-resume__button--primary">이어서 하기</button><button type="button" data-action="resume.check-choice" class="hx-resume__button">계획부터 다시</button></div></section>"`,
    );
    fireEvent.click(screen.getByRole('button', { name: '이어서 하기' }));
    expect(onChoose).toHaveBeenCalledWith('stale', 'continue');
  });

  it('끝낸 일이 없을 때 문구, 모두 쉬운 말', () => {
    const i = staleIssue(30, []);
    expect(i.body).toBe('멈춘 지 30일이 지났어요. 아직 끝낸 일은 없어요. 이대로 이어할까요?');
    expect(checkPlainKorean(i.body).violations).toEqual([]);
    expect(checkPlainKorean(staleIssue(8, DONE).body).violations).toEqual([]);
  });
});
