// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { enginesApi } from '../src/settings/Engines/api.js';
import { fakeApi, mount } from './settings-fixtures.js';

afterEach(cleanup);

describe('38.2 구독 | API 토글 + API 키', () => {
  it('API 선택 → 키 입력·저장 → 마스킹 표시, 입력란은 비움 (원문 화면에 남지 않음)', async () => {
    const { api, calls } = fakeApi();
    await mount(api);
    const claude = screen.getByRole('article', { name: 'Claude Code' });
    expect(within(claude).queryByLabelText('Claude Code API 키')).toBeNull(); // 구독 모드
    await act(async () => fireEvent.click(within(claude).getByLabelText('API')));
    expect(calls).toContainEqual(['settings', 'claude-code', { mode: 'apiKey' }]);
    expect(within(claude).getByTestId('key-masked').textContent).toBe('키 없음');
    const input = within(claude).getByLabelText('Claude Code API 키') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'sk-ant-SECRET-abcd' } });
    await act(async () => fireEvent.click(within(claude).getByRole('button', { name: '키 저장' })));
    expect(within(claude).getByTestId('key-masked').textContent).toBe('••••abcd');
    expect(input.value).toBe('');
    expect(document.body.innerHTML).not.toContain('SECRET');
    // 기존 키는 처음부터 마스킹 값으로
    const codex = screen.getByRole('article', { name: 'Codex' });
    expect(within(codex).getByTestId('key-masked').textContent).toBe('••••9xyz');
  });

  it('API 클라이언트: PUT /api/engines/:id/key 본문에만 원문, 경로 인코딩', async () => {
    const reqs: [string, RequestInit | undefined][] = [];
    const api = enginesApi({
      request: async <T,>(path: string, init?: RequestInit) => {
        reqs.push([path, init]);
        return { key: { masked: '••••' } } as T;
      },
    });
    await api.saveKey('codex', 'k');
    await api.saveSettings('claude-code', { model: null });
    await api.ping('codex');
    expect(reqs).toEqual([
      ['/api/engines/codex/key', { method: 'PUT', body: '{"key":"k"}' }],
      ['/api/engines/claude-code/settings', { method: 'PUT', body: '{"model":null}' }],
      ['/api/engines/codex/ping', { method: 'POST' }],
    ]);
  });
});
