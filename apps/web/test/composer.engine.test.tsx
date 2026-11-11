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

describe('보내는 지시의 엔진 (T-101 5C: 엔진 칩 대신 오른쪽 아래 모델 버튼)', () => {
  it('ai(메인 AI 등)를 주면 그 엔진으로 보낸다, 바뀌면 다음 턴부터', () => {
    const { onSend, container } = renderComposer({ ai: { engine: 'codex', model: 'gpt-5.5' } });
    expect(container.querySelector('.hx-chip--engine')).toBeNull();
    sendText('첫 턴');
    expect(onSend.mock.calls[0]![0].settings.engineId).toBe('codex');
  });

  it('ai가 없으면 감지된 첫 엔진', () => {
    const { onSend } = renderComposer();
    sendText('첫 턴');
    expect(onSend.mock.calls[0]![0].settings.engineId).toBe('claude-code');
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
