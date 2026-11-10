// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppShell } from '../src/shell/AppShell.js';
import { LAYOUT_KEY, loadLayout } from '../src/shell/layout-store.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const shell = () =>
  render(
    <AppShell
      topBar={{ runState: 'idle', quotas: [] }}
      sidebar={<nav aria-label="사이드바">사이드</nav>}
      main={<div>채팅</div>}
    />,
  );

const cssVar = (name: string) =>
  (document.querySelector('.hx-shell') as HTMLElement).style.getPropertyValue(name);

describe('3열 레이아웃과 경계 리사이즈', () => {
  it('기본 240px / 가변 / 360px', () => {
    shell();
    expect(cssVar('--hx-sidebar-w')).toBe('240px');
    expect(cssVar('--hx-right-w')).toBe('360px');
    expect(document.querySelector('.hx-shell')?.getAttribute('data-layout')).toBe('wide');
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('경계를 끌면 너비가 바뀌고, 놓으면 저장되며, 다시 열 때 복원', () => {
    shell();
    const [left, right] = screen.getAllByRole('separator');
    fireEvent.mouseDown(left!, { clientX: 240 });
    fireEvent.mouseMove(window, { clientX: 300 });
    expect(cssVar('--hx-sidebar-w')).toBe('300px');
    expect(localStorage.getItem(LAYOUT_KEY)).toBeNull(); // 끄는 중에는 저장 안 함
    fireEvent.mouseUp(window);
    expect(loadLayout().sidebarWidth).toBe(300);

    fireEvent.mouseDown(right!, { clientX: 900 });
    fireEvent.mouseMove(window, { clientX: 800 }); // 왼쪽으로 100 → 우측 패널 +100
    fireEvent.mouseUp(window);
    expect(loadLayout().rightWidth).toBe(460);

    fireEvent.mouseDown(left!, { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 2000 }); // 상한 400
    fireEvent.mouseUp(window);
    expect(loadLayout().sidebarWidth).toBe(400);

    cleanup();
    shell();
    expect(cssVar('--hx-sidebar-w')).toBe('400px');
    expect(cssVar('--hx-right-w')).toBe('460px');
  });

  it('키보드 ←/→로도 조절·저장', () => {
    shell();
    const [left] = screen.getAllByRole('separator');
    fireEvent.keyDown(left!, { key: 'ArrowRight' });
    expect(loadLayout().sidebarWidth).toBe(256);
  });
});
