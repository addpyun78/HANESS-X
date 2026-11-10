// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Tauri 모듈 모킹 (웹뷰 밖에서는 실제 IPC가 없다)
const invoke = vi.fn();
const open = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a: unknown[]) => open(...a) }));

const { App } = await import('../src/App.js');
const { pickFolderDesktop, waitForDesktopServer, isTauri } = await import('../src/api/desktop.js');

const WS = {
  name: 'app',
  path: '/mnt/c/work/app',
  lastUsedAt: '2026-11-10T00:00:00.000Z',
  git: false,
  hasAgentsMd: false,
  hasClaudeMd: false,
};

beforeEach(() => {
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  invoke.mockReset();
  open.mockReset();
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('데스크톱(Tauri) 모드 (T-063)', () => {
  it('63.3 폴더 선택: open({ directory: true }) — 선택/취소', async () => {
    expect(isTauri()).toBe(true);
    open.mockResolvedValueOnce('C:\\work\\app');
    expect(await pickFolderDesktop('C:\\work')).toEqual({ cancelled: false, path: 'C:\\work\\app' });
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ directory: true, multiple: false, defaultPath: 'C:\\work' }),
    );
    open.mockResolvedValueOnce(null);
    expect(await pickFolderDesktop('/mnt/c/work')).toEqual({ cancelled: true });
    expect(open.mock.calls[1]![0]).not.toHaveProperty('defaultPath'); // WSL 경로는 Windows 대화상자에 넘기지 않음
  });

  it('63.2 사이드카 서버 준비를 기다린다 (starting → ready), 실패면 오류', async () => {
    invoke
      .mockResolvedValueOnce({ state: 'starting' })
      .mockResolvedValueOnce({ state: 'ready', url: 'http://127.0.0.1:5555', token: 'tk' });
    const sleep = vi.fn(async () => {});
    expect(await waitForDesktopServer({ sleep })).toEqual({ url: 'http://127.0.0.1:5555', token: 'tk' });
    expect(invoke).toHaveBeenCalledWith('server_info');
    expect(sleep).toHaveBeenCalledOnce();
    invoke.mockResolvedValueOnce({ state: 'failed', message: 'wsl.exe 없음' });
    await expect(waitForDesktopServer({ sleep })).rejects.toThrow(/wsl\.exe 없음/);
  });

  it('App: 사이드카 주소로 접속, + → 폴더 열기는 Tauri 대화상자 → 등록 API', async () => {
    invoke.mockResolvedValue({ state: 'ready', url: 'http://127.0.0.1:5555', token: 'tk' });
    open.mockResolvedValue('C:\\work\\app');
    const calls: { url: string; method: string; body?: unknown; auth: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        const method = init.method ?? 'GET';
        calls.push({
          url,
          method,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
          auth: new Headers(init.headers).get('authorization'),
        });
        const path = new URL(url).pathname;
        const body =
          path === '/api/plugins'
            ? { plugins: [], rejected: [] }
            : path === '/api/workspaces'
              ? { recent: [] }
              : path === '/api/workspaces/open'
                ? { workspace: WS, recent: [WS] }
                : { error: 'not_found' };
        return new Response(JSON.stringify(body), { status: body && 'error' in body ? 404 : 200 });
      }),
    );
    vi.stubGlobal(
      'WebSocket',
      class {
        close() {}
      },
    );
    render(<App />);
    await waitFor(() => expect(calls.some((c) => c.url === 'http://127.0.0.1:5555/api/plugins')).toBe(true));
    expect(calls.every((c) => c.auth === 'Bearer tk')).toBe(true);
    fireEvent.click(screen.getByLabelText('추가'));
    fireEvent.click(screen.getByRole('menuitem', { name: /프로젝트 폴더 열기/ }));
    await waitFor(() => expect(screen.getByTestId('workspace').textContent).toContain('/mnt/c/work/app'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
    expect(calls.some((c) => c.url.endsWith('/api/native/pick-folder'))).toBe(false);
    expect(calls.find((c) => c.url.endsWith('/api/workspaces/open'))?.body).toEqual({
      path: 'C:\\work\\app',
    });
  });
});
