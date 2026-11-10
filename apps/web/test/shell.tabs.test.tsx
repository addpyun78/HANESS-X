// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppShell } from '../src/shell/AppShell.js';
import { LAYOUT_KEY, loadLayout, moveTab, sanitizeOrder } from '../src/shell/layout-store.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const shell = () =>
  render(<AppShell topBar={{ runState: 'idle', quotas: [] }} sidebar={<nav />} main={<div />} />);
const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent);

describe('우측 패널 탭 드래그 재배치', () => {
  it('moveTab·sanitizeOrder', () => {
    const o = ['checklist', 'diff', 'terminal', 'trajectory'] as const;
    expect(moveTab([...o], 'trajectory', 'checklist')).toEqual([
      'trajectory',
      'checklist',
      'diff',
      'terminal',
    ]);
    expect(moveTab([...o], 'checklist', 'terminal')).toEqual(['diff', 'terminal', 'checklist', 'trajectory']);
    expect(sanitizeOrder(['diff', 'diff', 'x'])).toEqual(['diff', 'checklist', 'terminal', 'trajectory']);
    expect(sanitizeOrder(null)).toEqual([...o]);
  });

  it('끌어 놓으면 순서가 바뀌고 저장되며, 다시 열 때 복원', () => {
    shell();
    expect(tabs()).toEqual(['체크리스트', 'Diff', '터미널', '궤적']);
    const [checklist, , , trajectory] = screen.getAllByRole('tab');
    fireEvent.dragStart(trajectory!);
    fireEvent.dragOver(checklist!);
    fireEvent.drop(checklist!);
    expect(tabs()).toEqual(['궤적', '체크리스트', 'Diff', '터미널']);
    expect(loadLayout().tabOrder).toEqual(['trajectory', 'checklist', 'diff', 'terminal']);

    cleanup();
    shell();
    expect(tabs()).toEqual(['궤적', '체크리스트', 'Diff', '터미널']);
  });

  it('키보드 Alt+→로 이동, 깨진 저장값은 기본 순서로 복구', () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ tabOrder: ['terminal', 'bogus'] }));
    shell();
    expect(tabs()).toEqual(['터미널', '체크리스트', 'Diff', '궤적']);
    fireEvent.keyDown(screen.getAllByRole('tab')[0]!, { key: 'ArrowRight', altKey: true });
    expect(tabs()).toEqual(['체크리스트', '터미널', 'Diff', '궤적']);
    expect(loadLayout().tabOrder[1]).toBe('terminal');
  });

  it('탭 클릭으로 내용 전환', () => {
    shell();
    fireEvent.click(screen.getByText('터미널'));
    expect(screen.getByRole('tabpanel').textContent).toContain('터미널');
  });
});
