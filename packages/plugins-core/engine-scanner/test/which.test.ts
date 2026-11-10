import { describe, expect, it } from 'vitest';
import { defaultExec, locateAll, locateCommand } from '@harness-x/engine-scanner';
import { mockExec, ok } from './helpers.js';

describe('10.2 PATH 탐지 (모킹)', () => {
  it('Windows: where.exe 출력에서 실행 가능한 경로만, CRLF 처리', async () => {
    const { exec, calls } = mockExec({
      'where.exe claude': ok(
        'C:\\Users\\u\\AppData\\Roaming\\npm\\claude\r\nC:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd\r\n',
      ),
      'where.exe codex': ok('C:\\Users\\u\\.local\\bin\\codex.exe\r\n'),
    });
    expect(await locateCommand('claude', { platform: 'win32', exec })).toEqual([
      'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd',
    ]);
    expect(calls[0]).toMatchObject({ file: 'where.exe', args: ['claude'] });
    const all = await locateAll(['claude', 'codex', 'agy'], { platform: 'win32', exec });
    expect(Object.fromEntries(all)).toEqual({
      claude: 'C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd',
      codex: 'C:\\Users\\u\\.local\\bin\\codex.exe',
    });
  });

  it('Unix: which -a, 중복 제거·우선 경로 사용, 없으면 빈 결과', async () => {
    const { exec, calls } = mockExec({
      'which -a claude': ok('/home/u/.local/bin/claude\n/usr/bin/claude\n/home/u/.local/bin/claude\n'),
      'which -a gemini': ok('', 1),
    });
    expect(await locateCommand('claude', { platform: 'linux', exec })).toEqual([
      '/home/u/.local/bin/claude',
      '/usr/bin/claude',
    ]);
    expect(calls[0]).toMatchObject({ file: 'which', args: ['-a', 'claude'] });
    expect(await locateCommand('gemini', { platform: 'linux', exec })).toEqual([]);
    const all = await locateAll(['claude', 'gemini'], { platform: 'darwin', exec });
    expect([...all.entries()]).toEqual([['claude', '/home/u/.local/bin/claude']]);
  });
});

describe('10.2 PATH 탐지 (실제 명령)', () => {
  it('실제 which/where로 node 경로를 찾는다', async () => {
    const paths = await locateCommand('node', { exec: defaultExec });
    expect(paths.length).toBeGreaterThan(0);
    expect(await locateCommand('definitely-not-a-real-cli-hx', { exec: defaultExec })).toEqual([]);
  });
});
