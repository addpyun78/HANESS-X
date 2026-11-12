// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESPONSE, fakeApi, mount } from './settings-fixtures.js';

afterEach(cleanup);

describe('T-101 5D.7 설정 > 엔진: 자동 상태 표시, [테스트 실행]은 선택 버튼', () => {
  it('스캔이 확인한 로그인 상태를 그대로 표시(상태 명령을 다시 부르지 않음), 테스트 실행은 눌렀을 때만 (스냅샷)', async () => {
    const resp = structuredClone(RESPONSE);
    resp.scan!.engines = resp.scan!.engines.map((e) => ({
      ...e,
      login: e.name === 'codex' ? ('loggedOut' as const) : ('loggedIn' as const),
    }));
    const login = vi.fn(async (id: string) => ({ engine: id, state: 'unknown' as const }));
    const ping = vi.fn(async (id: string) => ({ ok: true, engineId: id, text: 'pong', latencyMs: 5 }));
    const { api } = fakeApi({ list: async () => structuredClone(resp), login, ping });
    await mount(api);
    const codex = screen.getByRole('article', { name: 'Codex' });
    const claude = screen.getByRole('article', { name: 'Claude Code' });
    expect(within(codex).getByTestId('login-badge').textContent).toBe('로그인 필요');
    expect(within(claude).getByTestId('login-badge').textContent).toBe('로그인됨');
    expect(login).not.toHaveBeenCalled();
    expect(ping).not.toHaveBeenCalled();
    expect(within(codex).getByText('선택 · 상태는 자동으로 확인해요')).toBeTruthy();
    expect(within(codex).getByRole('button', { name: '테스트 실행' })).toBeTruthy();
    expect(codex.outerHTML).toMatchSnapshot();
    await act(async () => fireEvent.click(within(codex).getByRole('button', { name: '테스트 실행' })));
    expect(ping).toHaveBeenCalledWith('codex');
  });

  it('스캔이 로그인 상태를 모르면(예전 캐시) 예전처럼 상태 명령으로 묻는다', async () => {
    const login = vi.fn(async (id: string) => ({ engine: id, state: 'loggedIn' as const }));
    const { api } = fakeApi({ login });
    await mount(api);
    expect(login).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '다시 찾기' })).toBeTruthy();
  });
});
