// T-102 E.C2-003.1 재현: 하위 명령에 --help(-h)를 주면 사용법만 보여 주고 끝나야 한다(실제로 실행하면 안 됨)
// 예전: install은 '--help'를 설치 이름으로 찾고, tools allow는 도구 id로, run은 에이전트로, reindex는 색인을 다시 씀
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

describe.skipIf(!existsSync(cli))('하위 명령 --help (T-102 C2-003)', () => {
  const cases = [
    ['install', '--help'],
    ['tools', '--help'],
    ['tools', 'allow', '--help'],
    ['run', '--help'],
    ['reindex', '--help'],
    ['reindex', '-h'],
  ];
  for (const args of cases)
    it(`harness-x ${args.join(' ')} → 사용법, 종료코드 0, 파일 안 씀`, () => {
      const home = mkdtempSync(join(tmpdir(), 'hx-subhelp-'));
      try {
        const r = spawnSync(process.execPath, ['--no-warnings', cli, ...args], {
          env: { ...process.env, HOME: home, HARNESS_X_HOME: join(home, '.harness-x'), HARNESS_X_TOKEN: '' },
          cwd: home,
          encoding: 'utf8',
          timeout: 120_000,
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/사용법/);
        expect(r.stdout).toContain(`harness-x ${args[0]}`);
        expect(existsSync(join(home, '.harness-x', 'sessions'))).toBe(false);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }, 150_000);
});
