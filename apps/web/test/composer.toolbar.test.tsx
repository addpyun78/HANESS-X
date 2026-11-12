// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderComposer } from './composer.helpers.js';

afterEach(cleanup);

describe('하단 도구줄 배치 (T-101 5C.1 최종 입력창 모습)', () => {
  it('순서: + → 권한 칩 → 모드 칩(3A.3) → … → [엔진 · 모델 ▾] → (오른쪽 끝) 전송, 아래 판정 줄 (스냅샷)', () => {
    const { container, onPlus } = renderComposer({
      verdict: { itemId: '2.1', rung: 2, passed: true },
      modelPicker: (
        <button type="button" data-slot="model">
          claude-code · sonnet ▾
        </button>
      ),
    });
    const bar = screen.getByRole('toolbar', { name: '입력 도구' });
    const order = [...bar.children].map(
      (el) =>
        (el as HTMLElement).dataset.slot ??
        el.className
          .split(' ')
          .find((c) => /^hx-(chip--|send|composer__spacer)/.test(c))
          ?.replace('hx-', ''),
    );
    expect(order).toEqual(['plus', 'chip--permission', 'chip--mode', 'composer__spacer', 'model', 'send']);
    expect(bar.firstElementChild?.getAttribute('aria-label')).toBe('추가');
    expect(bar.lastElementChild?.getAttribute('aria-label')).toBe('전송');
    // 예전 왼쪽 엔진 칩·인증 칩은 모델 버튼으로 통합
    expect(screen.queryByLabelText('엔진: Claude Code')).toBeNull();
    expect(screen.queryByLabelText('인증: 구독')).toBeNull();
    expect(screen.getByLabelText('권한: 워크스페이스 쓰기')).toBeTruthy();
    expect(screen.getByTestId('verdict').textContent).toBe(
      '판정 · 항목 2.1 통과 · 사다리 2번째 칸(별칭 사전)',
    );
    fireEvent.click(screen.getByLabelText('추가'));
    expect(onPlus).toHaveBeenCalledOnce();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('간단 모드(빌더 대화 탭)에서는 모델 버튼도 숨김', () => {
    renderComposer({ compact: true, modelPicker: <button type="button">모델</button> });
    expect(screen.queryByText('모델')).toBeNull();
  });
});
