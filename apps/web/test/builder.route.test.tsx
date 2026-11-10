// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { currentRoute } from '../src/router.js';
import { Routes } from '../src/Routes.js';
import { mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(() => {
  cleanup();
  location.hash = '';
});

describe('44.1 메뉴 "에이전트 만들기" → /builder/new', () => {
  it('currentRoute: 해시 경로', () => {
    expect(currentRoute({ hash: '' })).toBe('/');
    expect(currentRoute({ hash: '#/builder/new' })).toBe('/builder/new');
    expect(currentRoute({ hash: '#foo' })).toBe('/');
  });

  it('사이드바 하단 메뉴 클릭 시 빌더 화면으로 이동', async () => {
    render(<Routes />);
    expect(screen.queryByText('새 에이전트 — 어디서 시작할까요?')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /에이전트 만들기/ }));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(location.hash).toBe('#/builder/new');
    // 빌더는 lazy 청크 — /mnt/c(WSL)에서는 첫 로딩이 느리다
    expect(
      await screen.findByText('새 에이전트 — 어디서 시작할까요?', undefined, { timeout: 60_000 }),
    ).toBeTruthy();
    expect(document.querySelector('.hx-builder')?.getAttribute('data-route')).toBe('/builder/new');

    // ← 대화로 → 메인 화면
    await act(async () => {
      fireEvent.click(screen.getByText('← 대화로'));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(currentRoute()).toBe('/');
    expect(screen.getByRole('menuitem', { name: /에이전트 만들기/ })).toBeTruthy();
  });
});
