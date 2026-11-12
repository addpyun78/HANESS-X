// @features F-019 F-077
// T-102 실제 serve에서 화면이 부르는 주소가 등록돼 있는지(테스트가 모듈을 직접 끼우면 놓치는 연결 누락을 잡는다)
//  - C2-001 체크리스트: GET /api/checklist/:session · /status 가 "Route not found"가 아니라 앱 응답
//  - C2-002 PC 안 음성 입력: GET /api/stt/status 200 { local: boolean }
// dist를 쓰므로 빌드된 상태에서 돈다(다른 cli 테스트처럼 여기서 다시 빌드하지 않는다 — 동시에 다시 빌드하면 흔들림, C1-010)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { setup } from './plugin-fixtures.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

describe.skipIf(!existsSync(cli))('serve 화면 주소 연결 (T-102 C2-001·C2-002)', () => {
  let env: ReturnType<typeof setup>;
  let kill = () => {};
  afterEach(() => {
    kill();
    env.cleanup();
  });

  it('체크리스트·음성 입력 주소가 등록돼 있다', async () => {
    env = setup();
    const child = spawn(
      process.execPath,
      ['--no-warnings', cli, 'serve', '--port', '0', '--workspace', env.workspace, '--no-watch'],
      {
        env: { ...process.env, HARNESS_X_HOME: env.home },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    kill = () => child.kill('SIGTERM');
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
      setTimeout(() => rej(new Error('timeout: ' + err)), 240_000);
    });
    const token = readFileSync(info.tokenFile, 'utf8').trim();
    const get = async (p: string) => {
      const r = await fetch(info.url + p, { headers: { authorization: `Bearer ${token}` } });
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    };
    for (const p of ['/api/checklist/s-none', '/api/checklist/s-none/status']) {
      const r = await get(p);
      expect(String(r.body.message ?? '')).not.toMatch(/Route .* not found/);
      expect(r.body.error).toBe('session_not_found');
    }
    const stt = await get('/api/stt/status');
    expect(stt.status).toBe(200);
    expect(typeof stt.body.local).toBe('boolean');
  }, 300_000);
});
