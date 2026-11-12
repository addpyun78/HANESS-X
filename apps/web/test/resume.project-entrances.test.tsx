// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectResumeCard } from '../src/recovery/ProjectResumeCard.js';
import { ResumeCountLink } from '../src/recovery/resume-entry.js';
import type { ResumableSessionData } from '../src/recovery/resume-list.js';
import type { ProjectsApi, ProjectView, SessionRecordView } from '../src/shell/projects/api.js';
import { useProjectShell } from '../src/shell/projects/useProjectShell.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const P = (id: string, name: string): ProjectView => ({
  id,
  name,
  rootPath: `/w/${name}`,
  createdAt: '2026-11-01T00:00:00.000Z',
  lastOpenedAt: '2026-11-01T00:00:00.000Z',
  pinned: false,
  order: 0,
  missing: false,
});

const S = (
  id: string,
  status: SessionRecordView['status'],
  extra: Partial<SessionRecordView> = {},
): SessionRecordView => ({
  id,
  projectId: 'a',
  title: `세션 ${id}`,
  titleLocked: true,
  status,
  cwd: '/w/alpha',
  origin: 'slash',
  draft: false,
  messageCount: 1,
  archived: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  lastActivityAt: '2026-11-01T00:00:00.000Z',
  ...extra,
});

function fakeApi(sessions: SessionRecordView[]): ProjectsApi {
  const projects = [P('a', 'alpha')];
  const ok = <T,>(v: T) => Promise.resolve(v);
  return {
    list: () => ok({ projects, noProject: 0 }),
    sessions: () => ok({ sessions }),
    add: () => Promise.reject(new Error('x')),
    suggestRoot: (path) => ok({ path, suggest: false }),
    scratch: () => Promise.reject(new Error('x')),
    patch: (id) => ok({ project: projects.find((p) => p.id === id)! }),
    remove: () => ok({}),
    order: () => ok({ projects }),
    setCurrent: () => ok({}),
    relink: (id) => ok({ project: projects.find((p) => p.id === id)! }),
    move: (id) => ok({ project: projects.find((p) => p.id === id)! }),
    reveal: () => ok({}),
    info: () => ok({ hasAgentsMd: true, hasClaudeMd: false, git: false }),
    createDraft: (projectId) =>
      ok(S(`d-${projectId}`, 'idle', { draft: true, title: '', titleLocked: false })),
    commit: () => Promise.reject(new Error('x')),
    leave: () => ok({ discarded: true }),
    changeProject: () => Promise.reject(new Error('x')),
    patchSession: () => Promise.reject(new Error('x')),
    removeSession: () => ok({}),
    pickFolder: () => ok({ cancelled: true }),
  };
}

const RESUMABLE: ResumableSessionData[] = [
  {
    sessionId: 'p1',
    projectId: 'a',
    title: '/qa 헤더',
    agent: { name: 'qa', command: '/qa', displayName: 'QA' },
    engineId: 'codex',
    progress: 0.5,
    paused: { reason: 'user', at: '2026-11-01T00:00:00.000Z', by: 'user' },
    startedAt: null,
  },
];

/** App과 같은 연결: onProjectOpen → 이어서 할 작업 카드, onResume, 빈 세션 화면 "이어서 할 작업 N개" */
function Harness({ api, onResume }: { api: ProjectsApi; onResume: (id: string) => void }) {
  const [list, setList] = useState<ResumableSessionData[]>([]);
  const [show, setShow] = useState(false);
  const shell = useProjectShell({
    api,
    events: [],
    onProjectOpen: (p) => {
      const l = RESUMABLE.filter((s) => s.projectId === p.id);
      setList(l);
      setShow(l.length > 0);
    },
    onResume: (s) => onResume(s.id),
    emptyExtra: <ResumeCountLink count={list.length} onOpen={() => setShow(true)} />,
  });
  if (!shell.enabled) return null;
  return (
    <>
      {shell.renderSidebar({})}
      {shell.main}
      {show && <ProjectResumeCard sessions={list} onResume={onResume} />}
    </>
  );
}

describe('2B.1·2B.2 0-2 사이드바에 실제로 연결된 입구', () => {
  it('2B.1 프로젝트를 열면 "이어서 할 작업이 있어요" 카드', async () => {
    const onResume = vi.fn();
    render(<Harness api={fakeApi([S('p1', 'paused')])} onResume={onResume} />);
    await screen.findByText('세션 p1');
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /^alpha$/ })));
    await screen.findByText('이어서 할 작업이 있어요');
    fireEvent.click(screen.getByRole('button', { name: '이어하기' }));
    expect(onResume).toHaveBeenCalledWith('p1');
  });

  it('① 세션 … 메뉴 [이어하기] (0B.29에서 숨겨 둔 항목이 켜짐)', async () => {
    const onResume = vi.fn();
    render(<Harness api={fakeApi([S('p1', 'paused')])} onResume={onResume} />);
    fireEvent.click(await screen.findByRole('button', { name: '세션 p1 메뉴' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '이어하기' }));
    await waitFor(() => expect(onResume).toHaveBeenCalledWith('p1'));
  });

  it('② ⏸ 멈춘 세션 줄 클릭 → 이어하기, 실행 중인 줄은 아님', async () => {
    const onResume = vi.fn();
    render(<Harness api={fakeApi([S('p1', 'paused'), S('r1', 'running')])} onResume={onResume} />);
    fireEvent.click((await screen.findByText('세션 r1')).closest('button')!);
    expect(onResume).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('세션 p1').closest('button')!);
    expect(onResume).toHaveBeenCalledWith('p1');
  });

  it('③ 빈 세션 화면(0B.18)의 "이어서 할 작업 N개"', async () => {
    const onResume = vi.fn();
    render(<Harness api={fakeApi([S('p1', 'paused')])} onResume={onResume} />);
    await screen.findByText('세션 p1');
    // [+](alpha에서 새 세션) → 프로젝트 열기 + 빈 세션 화면
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'alpha에서 새 세션' })));
    await screen.findByText('alpha에서 무엇을 할까요?');
    // 카드를 닫은 상태에서도 빈 화면에 개수가 보인다
    const link = await screen.findByRole('button', { name: '⏸ 이어서 할 작업 1개' });
    fireEvent.click(link);
    expect(screen.getByText('이어서 할 작업이 있어요')).toBeTruthy();
  });
});
