// A.13 harness-x serve 시작 → /api/health 첫 응답까지 3회 평균 → baseline.json.startupMs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeOut, root } from './lib.mjs';

const cli = join(root, 'packages', 'kernel', 'dist', 'cli.js');
async function once(port) {
  const home = mkdtempSync(join(tmpdir(), 'hx-audit-'));
  const t0 = Date.now();
  const p = spawn(
    process.execPath,
    [
      cli,
      'serve',
      '--port',
      String(port),
      '--no-watch',
      '--workspace',
      home,
      '--token-file',
      join(home, 'token'),
    ],
    {
      cwd: root,
      env: { ...process.env, HOME: home, USERPROFILE: home, HARNESS_X_HOME: join(home, '.harness-x') },
      stdio: 'ignore',
    },
  );
  try {
    for (;;) {
      if (Date.now() - t0 > 180_000) throw new Error('180초 안에 응답 없음');
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (r.status < 500) return Date.now() - t0;
      } catch {
        /* 아직 안 켜짐 */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    p.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(home, { recursive: true, force: true });
  }
}
const runs = [];
for (let k = 0; k < 3; k++) runs.push(await once(38900 + k));
const avg = Math.round(runs.reduce((a, b) => a + b, 0) / runs.length);
mergeOut('startupMs', { avg, runs });
console.log(JSON.stringify({ avg, runs }));
