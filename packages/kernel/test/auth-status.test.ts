import { describe, expect, it, vi } from 'vitest';
import {
  getLoginStatus,
  parseCodexAccountRead,
  parseCodexLoginStatus,
  type JsonRpcTransport,
  type StatusExec,
} from '../src/auth-status.js';

const out = (stdout: string, code = 0, stderr = '') => ({ code, stdout, stderr });

describe('13.5 로그인 상태 조회 (모킹 출력)', () => {
  it('codex login status 출력 파싱', () => {
    expect(parseCodexLoginStatus(out('Logged in using ChatGPT\n'))).toEqual({
      state: 'loggedIn',
      method: 'chatgpt',
    });
    expect(parseCodexLoginStatus(out('', 0, 'Logged in using an API key - sk-proj-***ABCD\n'))).toEqual({
      state: 'loggedIn',
      method: 'apiKey',
    });
    expect(parseCodexLoginStatus(out('Not logged in\n', 1))).toEqual({ state: 'loggedOut' });
    expect(parseCodexLoginStatus(out("error: unrecognized subcommand 'status'\n", 2))).toEqual({
      state: 'unknown',
    });
  });

  it('app-server account/read 결과 파싱', () => {
    expect(
      parseCodexAccountRead({
        account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus' },
        requiresOpenaiAuth: true,
      }),
    ).toEqual({ state: 'loggedIn', method: 'chatgpt', plan: 'plus' });
    expect(parseCodexAccountRead({ account: { type: 'apiKey' }, requiresOpenaiAuth: true })).toEqual({
      state: 'loggedIn',
      method: 'apiKey',
    });
    expect(parseCodexAccountRead({ account: null, requiresOpenaiAuth: true })).toEqual({
      state: 'loggedOut',
    });
    expect(parseCodexAccountRead({ weird: 1 })).toEqual({ state: 'unknown' });
  });

  it('getLoginStatus(codex): login status 우선, 알 수 없으면 app-server account/read', async () => {
    const exec = vi.fn<StatusExec>(async () => out('Logged in using ChatGPT\n'));
    const rpc = vi.fn<JsonRpcTransport>(async () => []);
    expect(await getLoginStatus('codex', { exec, rpc })).toEqual({
      engine: 'codex',
      state: 'loggedIn',
      method: 'chatgpt',
      source: 'codex login status',
    });
    expect(exec).toHaveBeenCalledWith('codex', ['login', 'status'], 10_000);
    expect(rpc).not.toHaveBeenCalled();

    const oldExec = vi.fn<StatusExec>(async () => out('', 2, "unrecognized subcommand 'status'"));
    const rpc2 = vi.fn<JsonRpcTransport>(async (_f, _a, msgs) => {
      expect(msgs.map((m) => m.method)).toEqual(['initialize', 'initialized', 'account/read']);
      return [
        { id: 1, result: { userAgent: 'codex/0.155.1' } },
        { id: 2, result: { account: { type: 'chatgpt', planType: 'pro' }, requiresOpenaiAuth: true } },
      ];
    });
    expect(await getLoginStatus('codex', { exec: oldExec, rpc: rpc2 })).toEqual({
      engine: 'codex',
      state: 'loggedIn',
      method: 'chatgpt',
      plan: 'pro',
      source: 'codex app-server account/read',
    });
    expect(rpc2.mock.calls[0]?.[1]).toEqual(['app-server']);
  });

  it('둘 다 실패하면 unknown, 상태 명령이 없는 엔진은 unknown', async () => {
    const exec = vi.fn<StatusExec>(async () => out('', null as unknown as number));
    const rpc = vi.fn<JsonRpcTransport>(async () => [{ id: 2, error: { message: 'unknown method' } }]);
    expect((await getLoginStatus('codex', { exec, rpc })).state).toBe('unknown');

    const never = vi.fn<StatusExec>();
    for (const engine of ['claude-code', 'antigravity', 'gemini']) {
      expect(await getLoginStatus(engine, { exec: never })).toEqual({
        engine,
        state: 'unknown',
        source: 'none',
      });
    }
    expect(never).not.toHaveBeenCalled();
  });
});
