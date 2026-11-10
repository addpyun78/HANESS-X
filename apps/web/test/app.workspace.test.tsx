// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOBILE_QUERY } from '../src/shell/mobile.js';
import { renderApp } from './app-fixtures.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const APP = {
  name: 'app',
  path: '/mnt/c/work/app',
  lastUsedAt: '2026-11-10T00:00:00.000Z',
  git: true,
  branch: 'feature/login',
  hasAgentsMd: true,
  hasClaudeMd: false,
};
const OLD = {
  name: 'old',
  path: '/mnt/c/work/old',
  lastUsedAt: '2026-11-09T00:00:00.000Z',
  git: false,
  hasAgentsMd: false,
  hasClaudeMd: false,
  pinned: true,
};

describe('워크스페이스 (T-035)', () => {
  it('35.4 + → 폴더 선택 → 등록 → 상단 바에 이름·경로·브랜치·AGENTS.md 표시', async () => {
    const { calls } = renderApp({
      'GET /api/workspaces': () => ({ body: { recent: [OLD] } }),
      'POST /api/native/pick-folder': () => ({ body: { cancelled: false, path: '/mnt/c/work/app' } }),
      'POST /api/workspaces/open': (b) =>
        (b as { path: string }).path === '/mnt/c/work/app'
          ? { body: { workspace: APP, recent: [OLD, APP] } }
          : undefined,
    });
    await waitFor(() => expect(calls.some((c) => c.path === '/api/workspaces')).toBe(true));
    fireEvent.click(screen.getByLabelText('추가'));
    fireEvent.click(screen.getByRole('menuitem', { name: /프로젝트 폴더 열기/ }));
    await waitFor(() => expect(screen.getByText('app')).toBeTruthy());
    const bar = screen.getByTestId('workspace');
    expect(bar.textContent).toContain('/mnt/c/work/app');
    expect(screen.getByLabelText('브랜치 feature/login')).toBeTruthy();
    expect(bar.textContent).toContain('AGENTS.md');
    expect(bar.textContent).not.toContain('CLAUDE.md');
    expect(calls.find((c) => c.path === '/api/workspaces/open')?.body).toEqual({ path: '/mnt/c/work/app' });
  });

  it('검증 거부(시스템 폴더) → 안내, 상단 바는 그대로', async () => {
    renderApp({
      'POST /api/native/pick-folder': () => ({ body: { cancelled: false, path: '/mnt/c/Windows' } }),
      'POST /api/workspaces/open': () => ({
        status: 400,
        body: { error: 'system_dir', message: '시스템 폴더는 프로젝트로 열 수 없습니다: /mnt/c/Windows' },
      }),
    });
    fireEvent.click(screen.getByLabelText('추가'));
    fireEvent.click(screen.getByRole('menuitem', { name: /프로젝트 폴더 열기/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('시스템 폴더'));
    expect(screen.getByText('프로젝트를 선택하세요')).toBeTruthy();
  });

  it('최근 프로젝트에서 고르면 등록 API로 다시 연다', async () => {
    const { calls } = renderApp({
      'GET /api/workspaces': () => ({ body: { current: APP, recent: [OLD, APP] } }),
      'POST /api/workspaces/open': () => ({
        body: { workspace: { ...OLD, pinned: true }, recent: [OLD, APP] },
      }),
    });
    await waitFor(() => expect(screen.getByText('app')).toBeTruthy()); // 현재 워크스페이스 복원
    fireEvent.click(screen.getByLabelText('추가'));
    fireEvent.click(screen.getByRole('menuitem', { name: /최근 프로젝트/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /old/ }));
    await waitFor(() => expect(screen.getByTestId('workspace').textContent).toContain('/mnt/c/work/old'));
    expect(calls.filter((c) => c.path === '/api/workspaces/open').map((c) => c.body)).toEqual([
      { path: '/mnt/c/work/old' },
    ]);
  });

  it('35.6 모바일 뷰포트: + → 최근 프로젝트 목록만 (스냅샷)', async () => {
    vi.stubGlobal(
      'matchMedia',
      (q: string) =>
        ({
          matches: q === MOBILE_QUERY || q.includes('max-width'),
          media: q,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    const { container, calls } = renderApp({
      'GET /api/workspaces': () => ({ body: { recent: [OLD, APP] } }),
    });
    await waitFor(() => expect(calls.some((c) => c.path === '/api/workspaces')).toBe(true));
    fireEvent.click(screen.getByLabelText('추가'));
    const menu = await screen.findByRole('menu', { name: '최근 프로젝트' });
    expect(screen.queryByRole('menuitem', { name: /프로젝트 폴더 열기/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /파일 첨부/ })).toBeNull();
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((e) => e.getAttribute('title'))).toEqual([
      '/mnt/c/work/old',
      '/mnt/c/work/app',
    ]);
    expect(menu.outerHTML).toMatchSnapshot();
    expect(container.querySelector('[data-layout="narrow"]')).toBeTruthy();
  });
});
