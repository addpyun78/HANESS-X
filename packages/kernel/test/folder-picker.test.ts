import { describe, expect, it, vi } from 'vitest';
import {
  buildPickerScript,
  detectPickerHost,
  encodePowerShell,
  findPowerShell,
  NativeFolderPicker,
  parsePickerOutput,
  PickerBusyError,
  PickerFailedError,
  powerShellArgs,
  toWslPath,
  winToWslFallback,
  type ExecFn,
  type ExecResult,
} from '../src/native/folder-picker.js';

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '' });

/** powershell -EncodedCommand 값 → 스크립트 본문 */
function decodeScript(args: string[]): string {
  const b = args[args.indexOf('-EncodedCommand') + 1]!;
  return Buffer.from(b, 'base64').toString('utf16le');
}

/** 대화상자를 띄우지 않는 가짜 exec: PowerShell 호출에는 정해 둔 stdout, wslpath는 흉내 */
function fakeExec(psStdout: string) {
  const calls: { cmd: string; args: string[] }[] = [];
  const exec: ExecFn = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === 'wslpath' && args[0] === '-u') return ok(winToWslFallback(args[1]!) + '\n');
    if (cmd === 'wslpath' && args[0] === '-w') return ok('C:\\from-wsl\n');
    if (cmd === 'sh') return { code: 1, stdout: '', stderr: '' }; // pwsh.exe 없음
    return ok(psStdout);
  };
  return { exec, calls };
}

describe('34.3 출력 파싱 (stdout JSON)', () => {
  it('경로 / 취소 / 오류 / 잡음 섞인 출력', () => {
    expect(parsePickerOutput('HXRESULT {"path":"C:\\\\work\\\\app"}\r\n')).toEqual({
      kind: 'path',
      path: 'C:\\work\\app',
    });
    // 비ASCII는 \uXXXX로 온다 (콘솔 코드페이지와 무관)
    expect(parsePickerOutput('HXRESULT {"path":"C:\\\\\\ud55c\\uae00"}')).toEqual({
      kind: 'path',
      path: 'C:\\한글',
    });
    expect(parsePickerOutput('HXRESULT {"cancelled":true}')).toEqual({ kind: 'cancelled' });
    expect(parsePickerOutput('HXRESULT {"error":"COM fail"}')).toEqual({
      kind: 'error',
      message: 'COM fail',
    });
    expect(parsePickerOutput('#< CLIXML\nWARNING: x\nHXRESULT {"path":"D:\\\\p"}\n\n')).toEqual({
      kind: 'path',
      path: 'D:\\p',
    });
    expect(parsePickerOutput('').kind).toBe('error');
    expect(parsePickerOutput('HXRESULT {oops').kind).toBe('error');
    expect(parsePickerOutput('HXRESULT {"path":"  "}')).toEqual({ kind: 'cancelled' });
  });

  it('pwsh 스크립트: Vista형 FolderBrowserDialog, 소유 창, 인자는 base64', () => {
    const s = buildPickerScript({ flavor: 'pwsh', initialPath: 'C:\\한글 폴더', title: "it's" });
    expect(s).toContain('System.Windows.Forms.FolderBrowserDialog');
    expect(s).toContain('UseDescriptionForTitle');
    expect(s).toContain('$d.ShowDialog($owner)');
    expect(s).toContain(Buffer.from('C:\\한글 폴더').toString('base64'));
    expect(s).not.toContain('한글');
    expect(s).not.toContain("it's");
    expect([...s].every((c) => c === '\t' || c === '\n' || c === '\r' || (c >= ' ' && c <= '~'))).toBe(true); // ASCII만 (5.1 ANSI 해석 문제 없음)
  });

  it('powershell -STA -EncodedCommand(UTF-16LE) 로 실행', () => {
    const args = powerShellArgs('Write-Output 1');
    expect(args).toContain('-STA');
    expect(args).toContain('-NoProfile');
    expect(decodeScript(args)).toBe('Write-Output 1');
    expect(encodePowerShell('a')).toBe(Buffer.from('a', 'utf16le').toString('base64'));
  });
});

describe('34.4 PowerShell 5.1 폴백 (IFileOpenDialog)', () => {
  it('pwsh가 없으면 powershell.exe + C# Add-Type IFileOpenDialog(FOS_PICKFOLDERS)', async () => {
    const { exec, calls } = fakeExec('HXRESULT {"cancelled":true}');
    const ps = await findPowerShell('wsl', exec, () => true);
    expect(ps.flavor).toBe('powershell');
    expect(ps.command).toMatch(/powershell\.exe$/i);

    await new NativeFolderPicker({ host: 'wsl', exec }).pick();
    const psCall = calls.find((c) => /powershell\.exe$/i.test(c.cmd))!;
    const s = decodeScript(psCall.args);
    expect(s).toContain('Add-Type -TypeDefinition');
    expect(s).toContain('42f85136-db7e-439c-85f1-e4075d135fc8'); // IFileOpenDialog
    expect(s).toContain('FOS_PICKFOLDERS = 0x20');
    expect(s).not.toContain('FolderBrowserDialog'); // 5.1의 구형 트리 대화상자는 쓰지 않음
  });

  it('pwsh가 있으면 pwsh (win32: where.exe, wsl: command -v pwsh.exe)', async () => {
    const exec: ExecFn = async (cmd) =>
      cmd === 'where.exe'
        ? ok('C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n')
        : ok('/mnt/c/Program Files/PowerShell/7/pwsh.exe\n');
    expect(await findPowerShell('win32', exec)).toEqual({
      command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      flavor: 'pwsh',
    });
    expect((await findPowerShell('wsl', exec)).flavor).toBe('pwsh');
    const none: ExecFn = async () => ({ code: 1, stdout: '', stderr: '' });
    expect(await findPowerShell('win32', none)).toEqual({ command: 'powershell.exe', flavor: 'powershell' });
  });
});

describe('34.5 소유 창', () => {
  it('두 스크립트 모두 숨은 TopMost 소유 창을 만들어 대화상자 소유자로 지정', () => {
    for (const flavor of ['pwsh', 'powershell'] as const) {
      const s = buildPickerScript({ flavor });
      expect(s).toContain('$owner.TopMost = $true');
      expect(s).toContain('$owner.Show()');
    }
    const s51 = buildPickerScript({ flavor: 'powershell' });
    expect(s51).toContain('[HxFolderPicker]::BringToFront($owner.Handle)');
    expect(s51).toContain('[HxFolderPicker]::Pick($owner.Handle');
  });
});

describe('34.6 취소', () => {
  it('취소 → {cancelled:true}', async () => {
    const { exec } = fakeExec('HXRESULT {"cancelled":true}\r\n');
    const p = new NativeFolderPicker({
      host: 'win32',
      exec,
      powershell: { command: 'pwsh', flavor: 'pwsh' },
    });
    expect(await p.pick()).toEqual({ cancelled: true });
  });

  it('스크립트 오류 → PickerFailedError', async () => {
    const { exec } = fakeExec('HXRESULT {"error":"bad"}');
    const p = new NativeFolderPicker({
      host: 'win32',
      exec,
      powershell: { command: 'pwsh', flavor: 'pwsh' },
    });
    await expect(p.pick()).rejects.toBeInstanceOf(PickerFailedError);
    expect(p.busy).toBe(false);
  });
});

describe('34.7 WSL: powershell.exe + wslpath -u', () => {
  it('C:\\work\\app → /mnt/c/work/app', async () => {
    const { exec, calls } = fakeExec('HXRESULT {"path":"C:\\\\work\\\\app"}');
    const p = new NativeFolderPicker({ host: 'wsl', exec });
    expect(await p.pick({ initialPath: '/home/me/proj' })).toEqual({ path: '/mnt/c/work/app' });
    expect(calls.some((c) => /powershell\.exe$/.test(c.cmd))).toBe(true);
    expect(calls).toContainEqual({ cmd: 'wslpath', args: ['-u', 'C:\\work\\app'] });
    // 처음 폴더는 wslpath -w로 Windows 경로로 바꿔 넘긴다
    expect(calls).toContainEqual({ cmd: 'wslpath', args: ['-w', '/home/me/proj'] });
  });

  it('단순 변환 폴백', () => {
    expect(winToWslFallback('C:\\work\\app')).toBe('/mnt/c/work/app');
    expect(winToWslFallback('D:\\')).toBe('/mnt/d');
    expect(winToWslFallback('E:/x/y/')).toBe('/mnt/e/x/y');
  });

  it.runIf(detectPickerHost() === 'wsl')('실제 wslpath -u', async () => {
    const { defaultExec } = await import('../src/native/folder-picker.js');
    expect(await toWslPath('C:\\work\\app', defaultExec)).toBe('/mnt/c/work/app');
  });

  it('환경 감지', () => {
    expect(detectPickerHost('win32', {})).toBe('win32');
    expect(detectPickerHost('linux', { WSL_DISTRO_NAME: 'Ubuntu' })).toBe('wsl');
    expect(detectPickerHost('linux', {}, () => 'Linux version 6.6 microsoft-standard-WSL2')).toBe('wsl');
    expect(detectPickerHost('linux', {}, () => 'Linux version 6.6 generic')).toBe('unsupported');
    expect(detectPickerHost('darwin', {})).toBe('unsupported');
  });
});

describe('34.8 동시 1개', () => {
  it('대화상자가 떠 있는 동안 두 번째 pick은 PickerBusyError', async () => {
    let release!: (r: ExecResult) => void;
    const exec = vi.fn<ExecFn>(
      () =>
        new Promise<ExecResult>((r) => {
          release = r;
        }),
    );
    const p = new NativeFolderPicker({
      host: 'win32',
      exec,
      powershell: { command: 'pwsh', flavor: 'pwsh' },
    });
    const first = p.pick();
    expect(p.busy).toBe(true);
    await expect(p.pick()).rejects.toBeInstanceOf(PickerBusyError);
    release(ok('HXRESULT {"path":"C:\\\\a"}'));
    expect(await first).toEqual({ path: 'C:\\a' });
    expect(p.busy).toBe(false);
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
