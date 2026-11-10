// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from './app-fixtures.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function openFolderFromMenu() {
  fireEvent.click(screen.getByLabelText('추가'));
  fireEvent.click(screen.getByRole('menuitem', { name: /프로젝트 폴더 열기/ }));
}

describe('+ → 프로젝트 폴더 열기 (App)', () => {
  it('34.6 대화상자 취소 → {cancelled:true}, 화면은 그대로', async () => {
    const { calls, container } = renderApp({
      'POST /api/native/pick-folder': () => ({ body: { cancelled: true } }),
    });
    await waitFor(() => expect(calls.some((c) => c.path === '/api/plugins')).toBe(true));
    const before = screen.getByTestId('workspace').innerHTML;
    await openFolderFromMenu();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/native/pick-folder')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('workspace').innerHTML).toBe(before);
    expect(screen.getByText('프로젝트를 선택하세요')).toBeTruthy();
    // 다른 요청(워크스페이스 등록 등)도 하지 않는다
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/native/pick-folder']);
    expect(container.querySelector('.hx-plus-menu')).toBeNull();
  });

  it('409(대화상자 이미 열림)도 화면 변화 없음', async () => {
    const { calls } = renderApp({
      'POST /api/native/pick-folder': () => ({ status: 409, body: { error: 'picker_busy' } }),
    });
    await openFolderFromMenu();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/native/pick-folder')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('프로젝트를 선택하세요')).toBeTruthy();
  });
});
