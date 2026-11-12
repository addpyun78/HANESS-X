// @vitest-environment jsdom
import type { HarnessEvent } from '@harness-x/protocol';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChecklistPanel } from '../src/panels/Checklist/ChecklistPanel.js';
import type { ProjectView, SessionRecordView } from '../src/shell/projects/api.js';
import { DEFAULT_PREFS, type SidebarPrefs } from '../src/shell/projects/prefs.js';
import { ProjectSidebar } from '../src/shell/projects/ProjectSidebar.js';
import { ModeBadge, modeFromEvents } from '../src/run-mode/ModeBadge.js';

afterEach(cleanup);

const NOW = new Date('2026-11-12T12:00:00.000Z');
const at = NOW.toISOString();
const project: ProjectView = {
  id: 'p1',
  name: 'imjang-note',
  rootPath: '/w/imjang-note',
  createdAt: at,
  lastOpenedAt: at,
  pinned: false,
  order: 0,
  missing: false,
};
const sess = (id: string, mode?: string): SessionRecordView => ({
  id,
  projectId: 'p1',
  title: `세션 ${id}`,
  titleLocked: false,
  status: 'running',
  cwd: '/w',
  origin: 'ui',
  draft: false,
  messageCount: 1,
  archived: false,
  createdAt: at,
  updatedAt: at,
  lastActivityAt: at,
  ...(mode ? { mode } : {}),
});

function prefs(): { load(): SidebarPrefs; save(p: SidebarPrefs): void } {
  let v: SidebarPrefs = { ...DEFAULT_PREFS };
  return { load: () => v, save: (p) => void (v = p) };
}

// T-101 3E.5 사이드바 세션·체크리스트 패널에 모드 배지
describe('3E.5 모드 배지', () => {
  it('사이드바 세션 줄: 계획·일반·오토 배지 (스냅샷)', () => {
    render(
      <ProjectSidebar
        projects={[project]}
        sessions={[sess('a', 'plan'), sess('b', 'normal'), sess('c', 'auto'), sess('d')]}
        currentProjectId="p1"
        activeSessionId="a"
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
    const badges = [...document.querySelectorAll('.hx-srow__mode')];
    expect(badges.map((b) => b.getAttribute('aria-label')).sort()).toEqual([
      '모드 계획',
      '모드 오토',
      '모드 일반',
    ]);
    expect(
      badges
        .map((b) => b.outerHTML)
        .sort()
        .join('\n'),
    ).toMatchSnapshot();
  });

  it('체크리스트 패널 머리에 모드 배지 — 세션 기록 이벤트에서 찾는다 (스냅샷)', () => {
    const events = [
      { id: '1', ts: at, sessionId: 's1', type: 'session_registered', session: { id: 's1', mode: 'plan' } },
      { id: '2', ts: at, sessionId: 's1', type: 'session_updated', session: { id: 's1', mode: 'auto' } },
      { id: '3', ts: at, sessionId: 's1', type: 'checklist_change', itemId: '1', from: null, to: 'todo' },
    ] as unknown as HarnessEvent[];
    expect(modeFromEvents(events, 's1')).toBe('auto');
    expect(modeFromEvents(events, 's2')).toBeUndefined();
    render(<ChecklistPanel events={events} />);
    const panel = screen.getByRole('region', { name: '체크리스트' });
    const badge = panel.querySelector('.hx-mode-badge')!;
    expect(badge.getAttribute('aria-label')).toBe('모드 오토');
    expect(badge.outerHTML).toMatchSnapshot();
  });

  it('모드를 직접 주면 그 값, 모드가 없으면 배지 없음', () => {
    render(<ModeBadge mode="plan" />);
    expect(screen.getByLabelText('모드 계획').className).toContain('hx-mode-badge--plan');
    cleanup();
    render(<ChecklistPanel events={[]} />);
    expect(document.querySelector('.hx-mode-badge')).toBeNull();
  });
});
