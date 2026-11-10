import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setup } from './plugin-fixtures.js';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

describe('harness-x serve', () => {
  let env: ReturnType<typeof setup>;
  let kill = () => {};
  beforeAll(() => {
    execFileSync('pnpm', ['run', 'build'], { cwd: pkgDir, stdio: 'ignore' });
  }, 120_000);
  afterEach(() => {
    kill();
    env.cleanup();
  });

  it('실행 후 API 응답', async () => {
    env = setup();
    env.copyHello();
    const child = spawn(
      process.execPath,
      ['--no-warnings', cli, 'serve', '--port', '0', '--workspace', env.workspace, '--no-watch'],
      {
        env: { ...process.env, HARNESS_X_HOME: env.home },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    kill = () => child.kill('SIGTERM');
    const info = await new Promise<{ url: string; tokenFile: string; plugins: string[] }>((res, rej) => {
      let buf = '';
      let err = '';
      child.stdout.on('data', (d) => {
        buf += d;
        const line = buf.split('\n').find((l) => l.includes('"listening"'));
        if (line) res(JSON.parse(line));
      });
      child.stderr.on('data', (d) => (err += d));
      child.on('exit', (code) => rej(new Error(`exit ${code}: ${err}`)));
      setTimeout(() => rej(new Error('timeout: ' + err)), 150_000);
    });
    expect(info.plugins).toContain('hello');
    const token = readFileSync(info.tokenFile, 'utf8').trim();
    const res = await fetch(info.url + '/api/plugins', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plugins: { id: string }[] };
    expect(body.plugins.map((p) => p.id)).toContain('hello');
  }, 180_000);
});
