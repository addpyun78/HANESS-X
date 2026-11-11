// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/shell/AppShell.js';
import type { ProjectsApi, ProjectView, SessionRecordView } from '../src/shell/projects/api.js';
import { useProjectShell, type ProjectOpenHook } from '../src/shell/projects/useProjectShell.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

function fakeApi(projects: ProjectView[]): ProjectsApi {
  const sessions: SessionRecordView[] = [];
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
      ok({
        id: `d-${projectId}`,
        projectId,
        title: '',
        titleLocked: false,
        status: 'idle',
        cwd: '/w',
        origin: 'ui',
        draft: true,
        messageCount: 0,
        archived: false,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        lastActivityAt: '2026-11-01T00:00:00.000Z',
      }),
    commit: () => Promise.reject(new Error('x')),
    leave: () => ok({ discarded: true }),
    changeProject: () => Promise.reject(new Error('x')),
    patchSession: () => Promise.reject(new Error('x')),
    removeSession: () => ok({}),
    pickFolder: () => ok({ cancelled: true }),
  };
}

function Harness({
  api,
  onProjectOpen,
  extra,
  wrap,
}: {
  api: ProjectsApi;
  onProjectOpen?: ProjectOpenHook;
  extra?: ProjectOpenHook;
  wrap?: boolean;
}) {
  const shell = useProjectShell({ api, events: [], ...(onProjectOpen ? { onProjectOpen } : {}) });
  const { onProjectOpen: subscribe } = shell;
  useEffect(() => (extra ? subscribe(extra) : undefined), [extra, subscribe]);
  if (!shell.enabled) return null;
  const side = shell.renderSidebar({});
  return wrap ? (
    <AppShell topBar={{ runState: 'idle', quotas: [] }} sidebar={side} main={shell.main} />
  ) : (
    <>
      {side}
      {shell.main}
    </>
  );
}

describe('0B.32 프로젝트 클릭 훅 onProjectOpen', () => {
  it('사이드바에서 프로젝트를 누르면 옵션 훅과 구독한 훅(2번 이어서 할 작업 카드 자리)이 그 프로젝트로 불린다', async () => {
    const opened = vi.fn();
    const subscribed = vi.fn();
    render(
      <Harness api={fakeApi([P('a', 'alpha'), P('b', 'beta')])} onProjectOpen={opened} extra={subscribed} />,
    );
    const btn = await screen.findByRole('button', { name: /^beta$/ });
    await act(async () => fireEvent.click(btn));
    await waitFor(() =>
      expect(opened).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', name: 'beta' })),
    );
    expect(subscribed).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    // [+](그 프로젝트에서 새 세션)로 열어도 불린다
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'alpha에서 새 세션' })));
    await waitFor(() => expect(opened).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' })));
  });
});

describe('0B.33 모바일(768px 미만)', () => {
  it('사이드바는 시트로 열리고 구조는 같다 (뷰포트 스냅샷)', async () => {
    vi.stubGlobal(
      'matchMedia',
      (q: string) =>
        ({
          matches: q.includes('max-width: 767.98px'),
          media: q,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    render(<Harness api={fakeApi([P('a', 'alpha')])} wrap />);
    const menuBtn = await screen.findByRole('button', { name: '사이드바 열기' });
    expect(screen.queryByRole('navigation', { name: '사이드바' })).toBeNull();
    fireEvent.click(menuBtn);
    const sheet = await screen.findByRole('dialog', { name: '사이드바' });
    const nav = within(sheet).getByRole('navigation', { name: '사이드바' });
    for (const sel of [
      '.hx-newsession',
      '.hx-psidebar__search',
      '.hx-psidebar__head',
      '.hx-psidebar__groups',
      '.hx-psidebar__controls',
      '.hx-sidebar__nav',
    ])
      expect(nav.querySelector(sel)).toBeTruthy();
    expect(sheet.className).toContain('hx-sheet--left');
    expect(nav.outerHTML).toMatchSnapshot();
  });
});
