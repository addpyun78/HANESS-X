// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectResumeCard } from '../src/recovery/ProjectResumeCard.js';
import {
  fetchProjectResumeList,
  pausedAgo,
  projectResumeList,
  type ResumableSessionData,
} from '../src/recovery/resume-list.js';
import { checkPlainKorean } from './plain-check.js';

afterEach(cleanup);

const NOW = new Date('2026-11-12T12:00:00.000Z');
const S = (
  id: string,
  projectId: string,
  at: string,
  reason: string,
  progress: number,
): ResumableSessionData => ({
  sessionId: id,
  projectId,
  title: `/design-qa 헤더 ${id}`,
  agent: { name: 'design-qa', command: '/design-qa', displayName: '디자인 검수', icon: '🎨' },
  engineId: 'codex',
  progress,
  paused: { reason, at, by: 'user' },
  startedAt: null,
});
const ALL = [
  S('s1', 'p1', '2026-11-12T09:00:00.000Z', 'user', 0.25),
  S('s3', 'p2', '2026-11-12T11:00:00.000Z', 'quota', 0.5),
  S('s4', 'p1', '2026-11-12T11:50:00.000Z', 'crash', 0.6),
];

describe('2B.1 프로젝트를 열면 "이어서 할 작업이 있어요"', () => {
  it('프로젝트 id → 미완료 세션 목록 (그 프로젝트만, 최신순)', () => {
    expect(projectResumeList('p1', ALL).map((s) => s.sessionId)).toEqual(['s4', 's1']);
    expect(projectResumeList('p9', ALL)).toEqual([]);
  });

  it('카드: 제목·에이전트·진행률·멈춘 이유·멈춘 시각 (스냅샷), [이어하기]', () => {
    const onResume = vi.fn();
    const { container } = render(
      <ProjectResumeCard sessions={projectResumeList('p1', ALL)} onResume={onResume} now={NOW} />,
    );
    expect(screen.getByText('이어서 할 작업이 있어요')).toBeTruthy();
    const items = screen.getAllByTestId('resume-item').map((li) => li.textContent);
    expect(items).toEqual([
      '/design-qa 헤더 s4🎨 디자인 검수60%멈춤 (오류로 멈춤)10분 전이어하기',
      '/design-qa 헤더 s1🎨 디자인 검수25%멈춤 (사용자가 멈춤)3시간 전이어하기',
    ]);
    expect(container.innerHTML).toMatchSnapshot();
    fireEvent.click(screen.getAllByRole('button', { name: '이어하기' })[1]!);
    expect(onResume).toHaveBeenCalledWith('s1');
  });

  it('미완료 세션이 없으면 카드 없음', () => {
    const { container } = render(<ProjectResumeCard sessions={[]} onResume={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('GET /api/resume?projectId= 로 가져오기', async () => {
    const request = vi.fn(async () => ({ sessions: ALL })) as unknown as <T>(p: string) => Promise<T>;
    const list = await fetchProjectResumeList(request, 'p 1/x');
    expect(request).toHaveBeenCalledWith('/api/resume?projectId=p%201%2Fx');
    expect(list).toEqual([]);
  });

  it('시각·문구는 쉬운 말', () => {
    expect(pausedAgo('2026-11-12T11:59:30.000Z', NOW)).toBe('방금');
    expect(pausedAgo('2026-11-09T12:00:00.000Z', NOW)).toBe('3일 전');
    for (const t of ['이어서 할 작업이 있어요', '이어하기', '10분 전'])
      expect(checkPlainKorean(t, { label: true }).ok).toBe(true);
  });
});
