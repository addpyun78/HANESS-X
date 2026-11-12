// @features F-011
import { describe, expect, it } from 'vitest';
import { scanAllEngines } from '@harness-x/engine-scanner';
import { mockExec, ok } from './helpers.js';

const CMD_V = 'for c in claude codex agy; do command -v "$c"; done; exit 0';

describe('11.3 Windows/WSL 둘 다 있으면 두 항목', () => {
  it('claude가 Windows PATH와 WSL 양쪽에 있으면 결과에 2개 항목', async () => {
    const { exec } = mockExec({
      'where.exe claude': ok('C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd\r\n'),
      'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd --version': ok('2.1.3 (Claude Code)\r\n'),
      'wsl.exe -l -q': ok(Buffer.from('Ubuntu\r\n', 'utf16le')),
      [`wsl.exe -d Ubuntu -e sh -lc ${CMD_V}`]: ok('/home/u/.local/bin/claude\n', 1),
      'wsl.exe -d Ubuntu -e /home/u/.local/bin/claude --version': ok('2.1.4 (Claude Code)\n'),
    });
    const all = await scanAllEngines({ exec, platform: 'win32' });
    const claude = all.filter((e) => e.name === 'claude');
    expect(claude).toHaveLength(2);
    expect(claude.map((e) => [e.location, e.path, e.version])).toEqual([
      ['windows', 'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd', '2.1.3'],
      ['wsl:Ubuntu', '/home/u/.local/bin/claude', '2.1.4'],
    ]);
  });

  it('wsl: false 로 끌 수 있다', async () => {
    const { exec, calls } = mockExec({});
    await scanAllEngines({ exec, platform: 'win32', wsl: false, targets: ['claude'] });
    expect(calls.every((c) => c.file !== 'wsl.exe')).toBe(true);
  });
});
