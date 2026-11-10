// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeApi, mount } from './settings-fixtures.js';

afterEach(cleanup);

describe('38.4 테스트 실행', () => {
  it('1턴 핑 결과·지연시간 표시, 실패 표시', async () => {
    const { api } = fakeApi();
    await mount(api);
    const codex = screen.getByRole('article', { name: 'Codex' });
    await act(async () => fireEvent.click(within(codex).getByRole('button', { name: '테스트 실행' })));
    expect(within(codex).getByTestId('ping-result').textContent).toBe('성공 · 812ms · pong');
    cleanup();
    const failing = fakeApi({
      ping: async (id) => ({
        ok: false,
        engineId: id,
        text: '',
        latencyMs: 3,
        error: 'auth_required: 로그인 필요',
      }),
    });
    await mount(failing.api);
    const c2 = screen.getByRole('article', { name: 'Codex' });
    await act(async () => fireEvent.click(within(c2).getByRole('button', { name: '테스트 실행' })));
    expect(within(c2).getByTestId('ping-result').textContent).toBe('실패 · auth_required: 로그인 필요');
  });
});
