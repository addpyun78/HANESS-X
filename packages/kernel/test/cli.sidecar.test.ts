import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ensureBuilt } from './ensure-built.js';
import { setup } from './plugin-fixtures.js';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** 63.2 데스크톱 사이드카 모드: 앱이 준 토큰으로 기동, stdin이 닫히면(앱 종료) 서버 프로세스도 끝난다 */
describe('harness-x serve --exit-with-stdin (데스크톱 사이드카)', () => {
  let env: ReturnType<typeof setup>;
  let kill = () => {};
  beforeAll(() => {
    ensureBuilt(pkgDir); // T-102 C1-010: dist가 새것이면 다시 빌드하지 않음(동시 빌드로 깨지던 흔들림)
  }, 120_000);
  afterEach(() => {
    kill();
    env.cleanup();
  });

  it('HARNESS_X_TOKEN·--token-file 사용, Tauri 출처 CORS, stdin 닫힘 → 종료', async () => {
    env = setup();
    const token = 'a'.repeat(64);
    const tokenFile = join(env.home, 'run', 'desktop-token');
    const child = spawn(
      process.execPath,
      [
        '--no-warnings',
        cli,
        'serve',
        '--port',
        '0',
        '--no-watch',
        '--exit-with-stdin',
        '--token-file',
        tokenFile,
      ],
      {
        env: { ...process.env, HARNESS_X_HOME: env.home, HARNESS_X_TOKEN: token },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    kill = () => child.kill('SIGKILL');
    const exited = new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
    const info = await new Promise<{ url: string; tokenFile: string }>((res, rej) => {
      let buf = '';
      let err = '';
      child.stdout.on('data', (d) => {
        buf += d;
        const line = buf.split('\n').find((l) => l.includes('"listening"'));
        if (line) res(JSON.parse(line));
      });
      child.stderr.on('data', (d) => (err += d));
      child.on('exit', (code) => rej(new Error(`exit ${code}: ${err}`)));
      setTimeout(() => rej(new Error('timeout: ' + err)), 300_000); // T-102 C1-010: 부하가 크면 기동이 150초를 넘음
    });
    expect(info.tokenFile).toBe(tokenFile);
    expect(readFileSync(tokenFile, 'utf8').trim()).toBe(token);
    expect(existsSync(join(env.home, 'run', 'token'))).toBe(false); // 브라우저 실행기 토큰 파일은 건드리지 않음

    const res = await fetch(info.url + '/api/health', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    // 데스크톱 웹뷰 출처: 사전 요청은 토큰 없이 204, 본 요청에 allow-origin
    const pre = await fetch(info.url + '/api/workspaces/open', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://tauri.localhost',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization');
    const evil = await fetch(info.url + '/api/health', {
      headers: { origin: 'http://evil.example', authorization: `Bearer ${token}` },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();

    // 앱 종료 = 파이프 닫힘
    const t0 = Date.now();
    child.stdin.end();
    const code = await Promise.race([
      exited,
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 30_000)),
    ]);
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(child.exitCode).toBe(0);
  }, 360_000);
});
