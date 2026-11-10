// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppShell } from '../src/shell/AppShell.js';

/** 뷰포트 너비를 흉내 내는 matchMedia (max-width 쿼리만 해석) */
let width = 1280;
const listeners = new Set<() => void>();
function setViewport(w: number) {
  width = w;
  act(() => listeners.forEach((l) => l()));
}
beforeEach(() => {
  width = 1280;
  window.matchMedia = ((q: string) => {
    const max = Number(/max-width:\s*([\d.]+)px/.exec(q)?.[1] ?? Infinity);
    return {
      get matches() {
        return width <= max;
      },
      media: q,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  listeners.clear();
});

const shell = () =>
  render(
    <AppShell
      topBar={{ runState: 'idle', quotas: [] }}
      sidebar={<nav aria-label="세션 사이드바">사이드</nav>}
      main={<div>채팅</div>}
    />,
  );
const layout = () => document.querySelector('.hx-shell')?.getAttribute('data-layout');

describe('768px 미만: 사이드바·우측 패널이 시트로 접힘', () => {
  it('넓은 화면(1280px): 3열, 시트 버튼 없음', () => {
    shell();
    expect(layout()).toBe('wide');
    expect(screen.getByLabelText('세션 사이드바')).toBeTruthy();
    expect(screen.getByLabelText('우측 패널')).toBeTruthy();
    expect(screen.queryByLabelText('사이드바 열기')).toBeNull();
  });

  it('767px: 접히고 버튼으로 시트 열기/닫기(배경 클릭·Esc)', () => {
    width = 767;
    shell();
    expect(layout()).toBe('narrow');
    expect(screen.queryByLabelText('세션 사이드바')).toBeNull();
    expect(screen.queryByLabelText('우측 패널')).toBeNull();
    expect(screen.queryAllByRole('separator')).toHaveLength(0);

    fireEvent.click(screen.getByLabelText('사이드바 열기'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('사이드바');
    expect(dialog.textContent).toContain('사이드');
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('패널 열기'));
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('우측 패널');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('창 크기 변경에 반응 (768 ↔ 767)', () => {
    width = 768;
    shell();
    expect(layout()).toBe('wide');
    setViewport(767);
    expect(layout()).toBe('narrow');
    fireEvent.click(screen.getByLabelText('사이드바 열기'));
    setViewport(1024);
    expect(layout()).toBe('wide');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
