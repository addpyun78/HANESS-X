// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderComposer } from './composer.helpers.js';
import { checkPlainKorean } from './plain-check.js';

afterEach(cleanup);

// T-101 3A.3 입력창 권한 칩 오른쪽에 [모드: 일반 ▾], 펼치면 모드 3개 + 쉬운 말 설명 한 줄씩
describe('3A.3 모드 칩', () => {
  it('권한 칩 바로 오른쪽, 기본은 일반, 펼치면 3개 + 설명 (스냅샷)', () => {
    const { onSettingsChange, onSend } = renderComposer();
    const chip = screen.getByLabelText('모드: 일반');
    const wrap = chip.closest('.hx-chip-wrap')!;
    expect(wrap.previousElementSibling?.classList.contains('hx-chip--permission')).toBe(true);
    expect(wrap.classList.contains('hx-chip--mode')).toBe(true);

    fireEvent.click(chip);
    const menu = screen.getByRole('menu', { name: '모드' });
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.querySelector('.hx-popover__label')?.textContent)).toEqual([
      '계획',
      '일반',
      '오토',
    ]);
    const descs = items.map((i) => i.querySelector('.hx-popover__desc')?.textContent ?? '');
    expect(descs).toHaveLength(3);
    for (const d of descs) expect(checkPlainKorean(d).ok, d).toBe(true);
    expect(items[1]!.getAttribute('aria-checked')).toBe('true');
    expect(menu.outerHTML).toMatchSnapshot();

    fireEvent.click(items[2]!);
    expect(screen.getByLabelText('모드: 오토')).toBeTruthy();
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'auto' }));
    fireEvent.change(screen.getByLabelText('지시 입력'), { target: { value: '정리해' } });
    fireEvent.click(screen.getByLabelText('전송'));
    expect(onSend.mock.calls[0]![0].settings.mode).toBe('auto');
  });

  it('처음 값(initialSettings.mode)을 따른다', () => {
    renderComposer({ initialSettings: { mode: 'plan' } });
    expect(screen.getByLabelText('모드: 계획')).toBeTruthy();
  });

  it('간단 모드(compact)에서는 숨긴다', () => {
    renderComposer({ compact: true });
    expect(screen.queryByLabelText(/^모드:/)).toBeNull();
  });
});
