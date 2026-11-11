// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderComposer } from './composer.helpers.js';

afterEach(cleanup);

describe('권한 칩 (읽기 전용 / 워크스페이스 쓰기 / 전체)', () => {
  it('선택이 세션 설정에 반영되고 전송 페이로드에 실린다', () => {
    const { onSend, onSettingsChange } = renderComposer({ initialSettings: { permission: 'read-only' } });
    fireEvent.click(screen.getByLabelText('권한: 읽기 전용'));
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.querySelector('.hx-popover__label')?.textContent)).toEqual([
      '읽기 전용',
      '워크스페이스 쓰기',
      '전체',
    ]);
    expect(items[0]!.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(items[2]!);
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      engineId: 'claude-code',
      auth: 'subscription',
      permission: 'full',
    });
    expect(screen.getByLabelText('권한: 전체')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('지시 입력'), { target: { value: '배포해' } });
    fireEvent.click(screen.getByLabelText('전송'));
    expect(onSend.mock.calls[0]![0].settings).toEqual({
      engineId: 'claude-code',
      auth: 'subscription',
      permission: 'full',
    });
  });

  it('기본값은 워크스페이스 쓰기', () => {
    renderComposer();
    expect(screen.getByLabelText('권한: 워크스페이스 쓰기')).toBeTruthy();
  });
});
