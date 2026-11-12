// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectResumeCard } from '../src/recovery/ProjectResumeCard.js';
import { DEFAULT_PREFS, type SidebarPrefs } from '../src/shell/projects/prefs.js';
import { ProjectSidebar } from '../src/shell/projects/ProjectSidebar.js';
import type { ProjectView, SessionRecordView } from '../src/shell/projects/api.js';

afterEach(cleanup);

const NOW = new Date('2026-11-12T12:00:00.000Z');
const T = '2026-11-12T11:58:00.000Z';
const proj = (id: string, name: string): ProjectView => ({
  id,
  name,
  rootPath: `/mnt/c/work/${name}`,
  createdAt: T,
  lastOpenedAt: T,
  pinned: false,
  order: 0,
  missing: false,
});
const sess = (id: string, projectId: string, extra: Partial<SessionRecordView>): SessionRecordView => ({
  id,
  projectId,
  title: id,
  titleLocked: false,
  status: 'idle',
  cwd: '/mnt/c/work',
  origin: 'ui',
  draft: false,
  messageCount: 1,
  archived: false,
  createdAt: T,
  updatedAt: T,
  lastActivityAt: T,
  ...extra,
});

function prefs() {
  let v: SidebarPrefs = { ...DEFAULT_PREFS };
  return { load: () => v, save: (p: SidebarPrefs) => void (v = p) };
}

function sidebar() {
  return render(
    <ProjectSidebar
      projects={[proj('p1', 'shop')]}
      sessions={[
        sess('s1', 'p1', {
          title: '헤더 고치기',
          status: 'running',
          agent: 'design-qa',
          stageProgress: '단계 2/3',
        }),
        sess('s2', 'p1', { title: '그냥 질문', status: 'running' }),
      ]}
      currentProjectId="p1"
      activeSessionId="s1"
      onNewSession={vi.fn()}
      onNewSessionIn={vi.fn()}
      onOpenFolder={vi.fn()}
      onSelectProject={vi.fn()}
      onSelectSession={vi.fn()}
      onProjectAction={vi.fn()}
      onSessionAction={vi.fn()}
      onReorder={vi.fn()}
      onArchiveMany={vi.fn()}
      onNavigate={vi.fn()}
      now={NOW}
      prefs={prefs()}
    />,
  );
}

describe('4F.8 사이드바 세션 줄에 단계 진행 "단계 2/3" (단계 1개면 표시 안 함)', () => {
  it('스냅샷', () => {
    const { container } = sidebar();
    const row = container.querySelector('[data-session-id="s1"]')!;
    expect(row.querySelector('small.hx-srow__stage')!.textContent).toBe('단계 2/3');
    expect(container.querySelector('[data-session-id="s2"] .hx-srow__stage')).toBeNull();
    expect(row.outerHTML).toMatchSnapshot();
  });
});

describe('4F.6 이어하기 카드 진행률 = "단계 2/3 · 항목 4/7"', () => {
  it('단계가 있으면 단계 기준, 없으면 기존 %', () => {
    render(
      <ProjectResumeCard
        now={NOW}
        onResume={vi.fn()}
        sessions={[
          {
            sessionId: 'a',
            projectId: 'p1',
            title: '/design-qa 헤더',
            agent: null,
            engineId: 'codex',
            progress: 0.4,
            paused: { reason: 'user', at: '2026-11-12T11:00:00.000Z', by: 'user' },
            startedAt: null,
            stageProgress: '단계 2/3 · 항목 4/7',
          },
          {
            sessionId: 'b',
            projectId: 'p1',
            title: '/fix 버튼',
            agent: null,
            engineId: 'codex',
            progress: 0.5,
            paused: { reason: 'user', at: '2026-11-12T11:00:00.000Z', by: 'user' },
            startedAt: null,
          },
        ]}
      />,
    );
    expect(screen.getByRole('progressbar', { name: '/design-qa 헤더 진행률' }).textContent).toBe(
      '단계 2/3 · 항목 4/7',
    );
    expect(screen.getByRole('progressbar', { name: '/fix 버튼 진행률' }).textContent).toBe('50%');
  });
});
