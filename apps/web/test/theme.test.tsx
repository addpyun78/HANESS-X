// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from '../src/design/ThemeToggle.js';
import { THEME_KEY } from '../src/design/theme.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('수동 테마 토글', () => {
  it('system → light → dark → system 순환, html[data-theme]·localStorage 반영', () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole('button');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('저장된 선택을 복원', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('다크');
  });
});
