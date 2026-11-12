// T-102 I.2 바탕화면 바로가기 재발 방지: 패널이 안 뜨던 원인(서버를 120초만 기다리고, 그 뒤에야 브라우저를 엶)과
// 검은 cmd 창이 다시 생기지 않게 실행기 파일의 핵심 약속을 확인한다
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../../scripts/launcher/', import.meta.url));
const sh = readFileSync(dir + 'start.sh', 'utf8');
const vbs = readFileSync(dir + 'start-harness.vbs')
  .subarray(2)
  .toString('utf16le');
const ps = readFileSync(dir + 'make-shortcut.ps1', 'utf8');

describe('바로가기 실행기 (T-102 I.2)', () => {
  it('브라우저는 하네스 서버를 켜기 전에 연다(화면이 먼저 보이고 "켜는 중"을 보여 줌)', () => {
    expect(sh.indexOf('explorer.exe')).toBeGreaterThan(0);
    expect(sh.indexOf('explorer.exe')).toBeLessThan(sh.indexOf('packages/kernel/dist/cli.js serve'));
  });
  it('토큰을 먼저 정해 서버에 같은 값(HARNESS_X_TOKEN)을 넘긴다', () => {
    expect(sh).toMatch(/HARNESS_X_TOKEN="\$TOKEN" setsid/);
  });
  it('서버를 넉넉히(300초) 기다리고, 죽으면 바로 멈춘다 · 성공 응답만 켜짐으로 본다(-f)', () => {
    expect(sh).toMatch(/wait_for "하네스 서버" api_up "\$RUN\/server.pid" 300/);
    expect(sh).toMatch(/kill -0/);
    expect(sh).toMatch(/curl -sf/);
  });
  it('지난 서버 로그를 남긴다(server.log.1)', () => {
    expect(sh).toMatch(/server\.log\.1/);
  });
  it('바로가기는 창 없이(VBS Run 창 0) 실행하고, 실패하면 알림만', () => {
    expect(vbs).toMatch(/sh\.Run\(cmd, 0, True\)/);
    expect(vbs).toMatch(/MsgBox/);
    expect(ps).toMatch(/wscript\.exe/);
    expect(ps).toMatch(/start-harness\.vbs/);
  });
});
