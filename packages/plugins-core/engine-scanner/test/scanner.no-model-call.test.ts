import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getLoginStatus } from '@harness-x/kernel';
import { EngineScanner, probeLocalLlms, scanAllEngines } from '@harness-x/engine-scanner';
import { mockExec, ok, tempDir } from './helpers.js';

/**
 * T-101 5A.6 시작 시 상태 판정은 모델 호출 없이(설치·버전·로그인 상태 명령만) → 사용량 소모 0.
 * 실제 스캔 경로(PATH 조회 → --version → 공식 로그인 상태 명령 → 로컬 LLM 목록)를 모킹으로 돌려
 * 나간 명령·요청을 전부 기록하고, 모델을 부르는 것(프롬프트 실행·채팅/생성 요청)이 하나도 없는지 본다.
 */
describe('5A.6 시작 시 모델 호출 0건', () => {
  const t = tempDir();
  afterEach(() => t.cleanup());

  it('시작 스캔에서 나간 명령·요청은 모두 상태 확인용이다', async () => {
    const { exec, calls } = mockExec({
      'which -a claude': ok('/usr/bin/claude\n'),
      'which -a codex': ok('/usr/bin/codex\n'),
      '/usr/bin/claude --version': ok('2.1.3 (Claude Code)\n'),
      '/usr/bin/codex --version': ok('codex-cli 0.46.0\n'),
    });
    const statusCalls: string[][] = [];
    const rpcCalls: string[] = [];
    const urls: { url: string; method: string }[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      urls.push({ url: String(input), method: init?.method ?? 'GET' });
      if (String(input).endsWith('/api/tags'))
        return new Response(JSON.stringify({ models: [{ name: 'llama3' }] }), { status: 200 });
      return new Response('no', { status: 404 });
    }) as typeof fetch;

    const s = new EngineScanner({
      cacheFile: join(t.dir, 'engines.json'),
      startupRetryMs: 0,
      platform: 'linux',
      scanEngines: () => scanAllEngines({ platform: 'linux', exec, wsl: false }),
      probeLocalLlms: () => probeLocalLlms({ fetch: fakeFetch, timeoutMs: 200 }),
      loginStatus: async (e) =>
        (
          await getLoginStatus(e.name, {
            executable: e.path,
            exec: async (file, args) => {
              statusCalls.push([file, ...args]);
              return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' };
            },
            rpc: async (_f, _a, messages) => {
              rpcCalls.push(...messages.map((m) => String(m.method)));
              return [];
            },
          })
        ).state,
    });
    const cache = await s.start();
    s.stop();

    expect(cache.engines.map((e) => [e.name, e.login])).toEqual([
      ['claude', 'unknown'],
      ['codex', 'loggedIn'],
    ]);
    // 실행한 명령: PATH 조회와 --version 뿐
    for (const c of calls) {
      const line = [c.file, ...c.args].join(' ');
      expect(line).toMatch(/^(which -a [a-z-]+|\/usr\/bin\/[a-z]+ --version)$/);
    }
    // 로그인 상태: 공식 상태 명령만 (codex login status). 모델 실행(exec/-p/--print/chat)은 없음
    expect(statusCalls).toEqual([['/usr/bin/codex', 'login', 'status']]);
    expect(rpcCalls).toEqual([]);
    const all = [...calls.map((c) => [c.file, ...c.args]), ...statusCalls].flat();
    for (const bad of ['exec', '-p', '--print', 'chat', 'run', 'turn/start', 'thread/start'])
      expect(all).not.toContain(bad);
    // 네트워크: 로컬 루프백의 모델 "목록" GET만 (생성·채팅 요청 없음)
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u.method).toBe('GET');
      expect(u.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/(api\/tags|v1\/models)$/);
    }
  });
});
