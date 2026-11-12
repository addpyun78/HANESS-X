// @vitest-environment jsdom
// @features F-126
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevActionGuard, unregisteredAction } from '../src/actions/DevActionGuard.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('T-101 0C.3 개발 모드 경고', () => {
  it('레지스트리에 없는 action을 누르면 콘솔 오류 + 화면 아래 빨간 배너', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <>
        <button type="button" data-action="nope.not-registered" onClick={() => {}}>
          <span>모르는 동작</span>
        </button>
        <DevActionGuard />
      </>,
    );
    expect(screen.queryByTestId('dev-action-banner')).toBeNull();
    fireEvent.click(screen.getByText('모르는 동작')); // 안쪽 요소를 눌러도 가장 가까운 data-action을 본다
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toContain('nope.not-registered');
    const banner = screen.getByTestId('dev-action-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('nope.not-registered');
    expect(banner.style.position).toBe('fixed');
    expect(banner.style.bottom).toBe('0px');
    expect(banner.style.background).toMatch(/c62828|198, 40, 40/);
    // 닫기
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByTestId('dev-action-banner')).toBeNull();
  });

  it('등록된 action·data-action 없는 곳은 조용하다', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <>
        <button type="button" data-action="composer.send" onClick={() => {}}>
          보내기
        </button>
        <p>글자</p>
        <DevActionGuard />
      </>,
    );
    fireEvent.click(screen.getByText('보내기'));
    fireEvent.click(screen.getByText('글자'));
    expect(err).not.toHaveBeenCalled();
    expect(screen.queryByTestId('dev-action-banner')).toBeNull();
    expect(unregisteredAction(null)).toBeUndefined();
  });
});
