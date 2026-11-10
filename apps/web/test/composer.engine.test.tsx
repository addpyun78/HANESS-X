// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { enginesFromPlugins } from '../src/composer/engines.js';
import { renderComposer } from './composer.helpers.js';

afterEach(cleanup);

const input = () => screen.getByLabelText('지시 입력');
const sendText = (t: string) => {
  fireEvent.change(input(), { target: { value: t } });
  fireEvent.keyDown(input(), { key: 'Enter' });
};

describe('엔진 칩 → 감지된 엔진 팝오버', () => {
  it('클릭하면 목록이 뜨고, 고르면 다음 턴 엔진이 바뀐다', () => {
    const { onSend, onSettingsChange } = renderComposer();
    sendText('첫 턴');
    expect(onSend.mock.calls[0]![0].settings.engineId).toBe('claude-code');

    const chip = screen.getByLabelText('엔진: Claude Code');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['✓Claude Code', 'Codex', 'Antigravity감지 안 됨']);
    expect((items[2] as HTMLButtonElement).disabled).toBe(true); // 감지 안 된 엔진은 선택 불가
    fireEvent.click(items[1]!);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ engineId: 'codex' }));

    sendText('둘째 턴');
    expect(onSend.mock.calls[1]![0].settings.engineId).toBe('codex');
  });

  it('Esc·바깥 클릭으로 닫힘', () => {
    renderComposer();
    fireEvent.click(screen.getByLabelText('엔진: Claude Code'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByLabelText('엔진: Claude Code'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('GET /api/plugins 응답에서 엔진 감지', () => {
    expect(
      enginesFromPlugins({
        plugins: [
          {
            id: 'hello',
            version: '0.1.0',
            displayName: 'hello',
            state: 'active',
            origin: 'core',
            slots: ['command'],
          },
          {
            id: 'engine-claude-code',
            version: '1.0.0',
            displayName: 'Claude Code',
            state: 'active',
            origin: 'core',
            slots: ['engine'],
            provides: { engine: ['claude-code'] },
          },
          {
            id: 'engine-codex',
            version: '1.0.0',
            displayName: 'Codex',
            state: 'error',
            origin: 'core',
            slots: ['engine'],
            provides: { engine: ['codex'] },
          },
        ],
        rejected: [],
      }),
    ).toEqual([
      { id: 'claude-code', label: 'Claude Code', available: true },
      { id: 'codex', label: 'Codex', available: false },
    ]);
  });
});
