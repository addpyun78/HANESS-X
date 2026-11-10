import { describe, expect, it } from 'vitest';
import { scanWsl, scanWslDistro, wslLookupScript } from '@harness-x/engine-scanner';
import { mockExec, ok } from './helpers.js';

const CMD_V = 'for c in claude codex agy; do command -v "$c"; done; exit 0';

describe('11.2 확인 스크립트', () => {
  it('이름마다 command -v (dash는 첫 인자만 확인), 셸 메타문자 이름 거부', () => {
    expect(wslLookupScript(['claude', 'codex-acp'])).toBe(
      'for c in claude codex-acp; do command -v "$c"; done; exit 0',
    );
    expect(() => wslLookupScript(['claude; rm -rf ~'])).toThrow(/잘못된 CLI 이름/);
  });
});

describe('11.2 배포판별 command -v → location: wsl:<배포판>', () => {
  it('wsl -d <배포판> -e sh -lc "command -v claude codex agy" 결과를 항목으로', async () => {
    const { exec, calls } = mockExec({
      [`wsl.exe -d Ubuntu -e sh -lc ${CMD_V}`]: ok(
        'Welcome to Ubuntu\n/home/u/.local/bin/claude\n/home/u/.local/bin/codex\n',
        1, // agy 없음 → command -v 종료 코드 1
      ),
      'wsl.exe -d Ubuntu -e /home/u/.local/bin/claude --version': ok('2.1.3 (Claude Code)\n'),
      'wsl.exe -d Ubuntu -e /home/u/.local/bin/codex --version': ok('codex-cli 0.46.0\n'),
    });
    const entries = await scanWslDistro('Ubuntu', { exec });
    expect(calls[0]).toMatchObject({
      file: 'wsl.exe',
      args: ['-d', 'Ubuntu', '-e', 'sh', '-lc', CMD_V],
    });
    expect(entries).toEqual([
      expect.objectContaining({
        name: 'claude',
        location: 'wsl:Ubuntu',
        path: '/home/u/.local/bin/claude',
        version: '2.1.3',
        status: 'ok',
      }),
      expect.objectContaining({ name: 'codex', location: 'wsl:Ubuntu', version: '0.46.0' }),
    ]);
  });

  it('Windows 호스트: 모든 배포판 확인, 다른 플랫폼에서는 실행하지 않음', async () => {
    const { exec, calls } = mockExec({
      'wsl.exe -l -q': ok(Buffer.from('Ubuntu\r\nDebian\r\n', 'utf16le')),
      [`wsl.exe -d Debian -e sh -lc ${CMD_V}`]: ok('/usr/local/bin/agy\n'),
      'wsl.exe -d Debian -e /usr/local/bin/agy --version': ok('1.4.12\n'),
    });
    const entries = await scanWsl({ exec, platform: 'win32' });
    expect(entries.map((e) => [e.name, e.location])).toEqual([['agy', 'wsl:Debian']]);
    const before = calls.length;
    expect(await scanWsl({ exec, platform: 'linux' })).toEqual([]);
    expect(calls.length).toBe(before);
  });
});
