// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderComposer } from './composer.helpers.js';

afterEach(cleanup);

describe('하단 도구줄 배치 (컨셉 A)', () => {
  it('순서: + → 엔진 칩 → 인증 칩(구독/API) → 권한 칩 → 모드 칩 → (오른쪽 끝) 전송, 아래 판정 줄 (스냅샷)', () => {
    const { container, onPlus } = renderComposer({ verdict: { itemId: '2.1', rung: 2, passed: true } });
    const bar = screen.getByRole('toolbar', { name: '입력 도구' });
    const order = [...bar.children].map(
      (el) =>
        (el as HTMLElement).dataset.slot ??
        el.className
          .split(' ')
          .find((c) => /^hx-(chip--|send|composer__spacer)/.test(c))
          ?.replace('hx-', ''),
    );
    expect(order).toEqual([
      'plus',
      'chip--engine',
      'chip--auth',
      'chip--permission',
      'chip--mode',
      'composer__spacer',
      'send',
    ]);
    expect(bar.firstElementChild?.getAttribute('aria-label')).toBe('추가');
    expect(bar.lastElementChild?.getAttribute('aria-label')).toBe('전송');
    expect(screen.getByLabelText('엔진: Claude Code')).toBeTruthy();
    expect(screen.getByLabelText('인증: 구독')).toBeTruthy();
    expect(screen.getByLabelText('권한: 워크스페이스 쓰기')).toBeTruthy();
    expect(screen.getByTestId('verdict').textContent).toBe(
      '판정 · 항목 2.1 통과 · 사다리 2번째 칸(별칭 사전)',
    );
    fireEvent.click(screen.getByLabelText('추가'));
    expect(onPlus).toHaveBeenCalledOnce();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('인증 칩: 구독 ↔ API', () => {
    const { onSettingsChange } = renderComposer();
    fireEvent.click(screen.getByLabelText('인증: 구독'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'API' }));
    expect(screen.getByLabelText('인증: API')).toBeTruthy();
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ auth: 'api' }));
  });
});
