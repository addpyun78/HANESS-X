import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/**
 * 네이티브 폴더 대화상자 (T-034)
 *
 * 브라우저는 폴더의 실제 경로를 알려주지 않으므로, + 버튼은 로컬 하네스 서버에 대화상자를 요청한다.
 * - Windows: pwsh(PowerShell 7)가 있으면 .NET의 Vista형 FolderBrowserDialog (STA)
 *            없으면 Windows PowerShell 5.1에서 IFileOpenDialog(FOS_PICKFOLDERS)를 C# Add-Type으로 호출
 * - 두 경우 모두 숨은 TopMost 소유 창을 만들어 대화상자가 브라우저 뒤에 숨지 않게 한다
 * - WSL: powershell.exe(또는 pwsh.exe)를 호출하고 결과를 `wslpath -u`로 변환
 * - 결과는 stdout 한 줄 JSON: {"path":"C:\\..."} | {"cancelled":true} | {"error":"..."}
 *   (비ASCII 문자는 \uXXXX로 이스케이프 → 콘솔 코드페이지와 무관)
 * - 동시에 하나만 띄운다. 두 번째 요청은 PickerBusyError (API는 409)
 */

export type PickFolderResult = { cancelled: true } | { cancelled?: false; path: string };

export interface PickFolderOptions {
  /** 처음 열 폴더 (Windows 경로 또는 WSL 경로) */
  initialPath?: string;
  title?: string;
}

export interface FolderPicker {
  pick(opts?: PickFolderOptions): Promise<PickFolderResult>;
  /** 대화상자가 떠 있는 중인지 */
  readonly busy: boolean;
}

export type PickerHost = 'win32' | 'wsl' | 'unsupported';
export type PowerShellFlavor = 'pwsh' | 'powershell';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type ExecFn = (cmd: string, args: string[]) => Promise<ExecResult>;

export class PickerBusyError extends Error {
  readonly code = 'picker_busy';
  constructor() {
    super('폴더 대화상자가 이미 열려 있습니다');
  }
}

export class PickerUnsupportedError extends Error {
  readonly code = 'unsupported_platform';
  constructor(platform: string) {
    super(`이 환경(${platform})에서는 네이티브 폴더 대화상자를 띄울 수 없습니다`);
  }
}

export class PickerFailedError extends Error {
  readonly code = 'picker_failed';
}

// ── 환경 감지 ─────────────────────────────────────────────────────

export function detectPickerHost(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  readVersion: () => string = () => {
    try {
      return readFileSync('/proc/version', 'utf8');
    } catch {
      return '';
    }
  },
): PickerHost {
  if (platform === 'win32') return 'win32';
  if (platform === 'linux' && (env.WSL_DISTRO_NAME || env.WSL_INTEROP || /microsoft/i.test(readVersion())))
    return 'wsl';
  return 'unsupported';
}

export const WSL_POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

/** 쓸 PowerShell 실행 파일: pwsh 우선, 없으면 Windows PowerShell 5.1 */
export async function findPowerShell(
  host: PickerHost,
  exec: ExecFn,
  exists: (p: string) => boolean = existsSync,
): Promise<{ command: string; flavor: PowerShellFlavor }> {
  if (host === 'win32') {
    const r = await exec('where.exe', ['pwsh.exe']).catch(() => undefined);
    const first = r?.code === 0 ? r.stdout.split(/\r?\n/).find((l) => l.trim()) : undefined;
    if (first) return { command: first.trim(), flavor: 'pwsh' };
    return { command: 'powershell.exe', flavor: 'powershell' };
  }
  if (host === 'wsl') {
    const r = await exec('sh', ['-c', 'command -v pwsh.exe']).catch(() => undefined);
    const first = r?.code === 0 ? r.stdout.trim().split('\n')[0] : undefined;
    if (first) return { command: first, flavor: 'pwsh' };
    if (exists(WSL_POWERSHELL)) return { command: WSL_POWERSHELL, flavor: 'powershell' };
    return { command: 'powershell.exe', flavor: 'powershell' };
  }
  throw new PickerUnsupportedError(process.platform);
}

// ── 경로 변환 ─────────────────────────────────────────────────────

/** wslpath가 없을 때 쓰는 단순 변환: C:\work\app → /mnt/c/work/app */
export function winToWslFallback(p: string): string {
  const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(p);
  if (!m) return p.replace(/\\/g, '/');
  const rest = m[2]!.replace(/\\/g, '/').replace(/\/+$/, '');
  return `/mnt/${m[1]!.toLowerCase()}${rest ? '/' + rest : ''}`;
}

/** Windows 경로 → WSL 경로 (`wslpath -u`, 실패 시 단순 변환) */
export async function toWslPath(winPath: string, exec: ExecFn): Promise<string> {
  const r = await exec('wslpath', ['-u', winPath]).catch(() => undefined);
  const out = r?.code === 0 ? r.stdout.trim() : '';
  return out || winToWslFallback(winPath);
}

/** WSL 경로 → Windows 경로 (`wslpath -w`). 이미 Windows 경로면 그대로 */
export async function toWindowsPath(p: string, exec: ExecFn): Promise<string> {
  if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')) return p;
  const r = await exec('wslpath', ['-w', p]).catch(() => undefined);
  return r?.code === 0 ? r.stdout.trim() : p;
}

// ── PowerShell 스크립트 ─────────────────────────────────────────────

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** 결과 출력: ConvertTo-Json 뒤 비ASCII를 \uXXXX로 (5.1·7 공통) */
const PS_OUT = String.raw`
function Out-HxJson($o) {
  $j = ConvertTo-Json -Compress -InputObject $o
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $j.ToCharArray()) {
    $n = [int]$ch
    if ($n -gt 126) { [void]$sb.Append('\u' + $n.ToString('x4')) } else { [void]$sb.Append($ch) }
  }
  [Console]::Out.WriteLine('HXRESULT ' + $sb.ToString())
}
`;

/** 34.5 숨은 TopMost 소유 창 (화면 가운데 1×1, 투명) — 대화상자가 이 창 소유가 되어 맨 앞에 뜬다 */
const psOwner = (show: boolean) => String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0
$owner.Text = $title
${show ? '$owner.Show()\n$owner.Activate()' : ''}
`;

/** 34.4 IFileOpenDialog(FOS_PICKFOLDERS) — .NET Framework(5.1)·.NET(7) 모두에서 컴파일되는 C# */
export const IFILEOPENDIALOG_CS = String.raw`
using System;
using System.Runtime.InteropServices;
public static class HxFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] private class FileOpenDialogCo {}
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr hwndOwner);
    void SetFileTypes(uint c, IntPtr f);
    void SetFileTypeIndex(uint i);
    void GetFileTypeIndex(out uint i);
    void Advise(IntPtr p, out uint c);
    void Unadvise(uint c);
    void SetOptions(uint fos);
    void GetOptions(out uint fos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string n);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string n);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, int fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string e);
    void Close(int hr);
    void SetClientGuid(ref Guid g);
    void ClearClientData();
    void SetFilter(IntPtr f);
    void GetResults(out IntPtr ppenum);
    void GetSelectedItems(out IntPtr ppsai);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdn, out IntPtr ppszName);
    void GetAttributes(uint mask, out uint attribs);
    void Compare(IShellItem psi, uint hint, out int order);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IShellItem item);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  private const uint FOS_NOCHANGEDIR = 0x8, FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800;
  private const uint SIGDN_FILESYSPATH = 0x80058000;
  private const int ERROR_CANCELLED = unchecked((int)0x800704C7);

  /** 전경 잠금 해제(Alt 키 한 번) 후 소유 창을 앞으로 */
  public static void BringToFront(IntPtr owner) {
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    SetForegroundWindow(owner);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
  }

  /** 선택한 폴더 경로, 취소면 null */
  public static string Pick(IntPtr owner, string initial, string title) {
    IFileOpenDialog d = (IFileOpenDialog)new FileOpenDialogCo();
    try {
      uint o; d.GetOptions(out o);
      d.SetOptions(o | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR);
      if (!String.IsNullOrEmpty(title)) d.SetTitle(title);
      if (!String.IsNullOrEmpty(initial)) {
        try {
          Guid iid = typeof(IShellItem).GUID; IShellItem it;
          SHCreateItemFromParsingName(initial, IntPtr.Zero, ref iid, out it);
          d.SetFolder(it);
        } catch { }
      }
      int hr = d.Show(owner);
      if (hr == ERROR_CANCELLED) return null;
      if (hr != 0) Marshal.ThrowExceptionForHR(hr);
      IShellItem res; d.GetResult(out res);
      IntPtr p; res.GetDisplayName(SIGDN_FILESYSPATH, out p);
      try { return Marshal.PtrToStringUni(p); } finally { Marshal.FreeCoTaskMem(p); }
    } finally { Marshal.ReleaseComObject(d); }
  }
}
`;

export interface PickerScriptOptions {
  flavor: PowerShellFlavor;
  /** Windows 경로 */
  initialPath?: string;
  title?: string;
  /** 대화상자 없이 형식 로드·컴파일만 확인 → {"dryRun":true} */
  dryRun?: boolean;
}

/**
 * 대화상자 스크립트 (powershell -STA -EncodedCommand 로 실행).
 * 문자열 인자는 base64(UTF-8)로 넣어 따옴표·한글 문제를 피한다. 스크립트 본문은 ASCII만 쓴다.
 */
export function buildPickerScript(o: PickerScriptOptions): string {
  const head = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$dec = { param($s) [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }
$initial = & $dec '${b64(o.initialPath ?? '')}'
$title = & $dec '${b64(o.title ?? 'Open project folder')}'
${PS_OUT}
try {
`;
  const tail = String.raw`
} catch {
  Out-HxJson @{ error = $_.Exception.Message }
  exit 1
}
`;
  let body: string;
  if (o.flavor === 'pwsh') {
    // 34.3 PowerShell 7(.NET): FolderBrowserDialog가 Vista형(IFileDialog) 대화상자를 띄운다
    body = String.raw`
${psOwner(!o.dryRun)}
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $title
$d.UseDescriptionForTitle = $true
$d.ShowNewFolderButton = $true
if ($initial) { $d.InitialDirectory = $initial }
if (${o.dryRun ? '$true' : '$false'}) { Out-HxJson @{ dryRun = $true; flavor = 'pwsh' }; exit 0 }
$r = $d.ShowDialog($owner)
$owner.Close()
if ($r -eq [System.Windows.Forms.DialogResult]::OK -and $d.SelectedPath) { Out-HxJson @{ path = $d.SelectedPath } }
else { Out-HxJson @{ cancelled = $true } }
`;
  } else {
    // 34.4 Windows PowerShell 5.1: FolderBrowserDialog는 구형 트리이므로 IFileOpenDialog를 직접 호출
    body = String.raw`
Add-Type -TypeDefinition @'
${IFILEOPENDIALOG_CS}
'@
if (${o.dryRun ? '$true' : '$false'}) { Out-HxJson @{ dryRun = $true; flavor = 'powershell' }; exit 0 }
${psOwner(true)}
[HxFolderPicker]::BringToFront($owner.Handle)
$p = [HxFolderPicker]::Pick($owner.Handle, $initial, $title)
$owner.Close()
if ($p) { Out-HxJson @{ path = $p } } else { Out-HxJson @{ cancelled = $true } }
`;
  }
  return head + body + tail;
}

/** PowerShell -EncodedCommand 값 (UTF-16LE base64) */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function powerShellArgs(script: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-EncodedCommand',
    encodePowerShell(script),
  ];
}

// ── 출력 파싱 ─────────────────────────────────────────────────────

export type ParsedPickerOutput =
  | { kind: 'path'; path: string }
  | { kind: 'cancelled' }
  | { kind: 'dryRun'; flavor?: string }
  | { kind: 'error'; message: string };

/** stdout에서 마지막 `HXRESULT {json}` 줄을 찾아 해석 (CLIXML·경고 등 잡음 무시) */
export function parsePickerOutput(stdout: string): ParsedPickerOutput {
  const lines = stdout.split(/\r?\n/).filter((l) => l.startsWith('HXRESULT '));
  const last = lines.at(-1);
  if (!last) return { kind: 'error', message: '대화상자 결과 없음' };
  let v: unknown;
  try {
    v = JSON.parse(last.slice('HXRESULT '.length));
  } catch {
    return { kind: 'error', message: `결과 JSON 해석 실패: ${last.slice(0, 200)}` };
  }
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.error === 'string') return { kind: 'error', message: o.error };
  if (o.dryRun === true)
    return { kind: 'dryRun', ...(typeof o.flavor === 'string' ? { flavor: o.flavor } : {}) };
  if (o.cancelled === true) return { kind: 'cancelled' };
  if (typeof o.path === 'string' && o.path.trim()) return { kind: 'path', path: o.path };
  return { kind: 'cancelled' };
}

// ── 피커 ─────────────────────────────────────────────────────────

export const defaultExec: ExecFn = (cmd, args) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { windowsHide: true, maxBuffer: 1 << 20, encoding: 'utf8', timeout: 30 * 60_000 },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });

export interface NativeFolderPickerOptions {
  host?: PickerHost;
  exec?: ExecFn;
  /** PowerShell 실행 파일·종류 고정 (테스트·설정) */
  powershell?: { command: string; flavor: PowerShellFlavor };
}

export class NativeFolderPicker implements FolderPicker {
  private inFlight = false;
  private readonly host: PickerHost;
  private readonly exec: ExecFn;
  private readonly opts: NativeFolderPickerOptions;

  constructor(opts: NativeFolderPickerOptions = {}) {
    this.opts = opts;
    this.host = opts.host ?? detectPickerHost();
    this.exec = opts.exec ?? defaultExec;
  }

  get busy(): boolean {
    return this.inFlight;
  }

  async pick(o: PickFolderOptions = {}): Promise<PickFolderResult> {
    if (this.inFlight) throw new PickerBusyError(); // 34.8
    if (this.host === 'unsupported') throw new PickerUnsupportedError(process.platform);
    this.inFlight = true;
    try {
      const ps = this.opts.powershell ?? (await findPowerShell(this.host, this.exec));
      const initialPath =
        o.initialPath && this.host === 'wsl' ? await toWindowsPath(o.initialPath, this.exec) : o.initialPath;
      const script = buildPickerScript({ flavor: ps.flavor, initialPath, title: o.title });
      const r = await this.exec(ps.command, powerShellArgs(script));
      const out = parsePickerOutput(r.stdout);
      if (out.kind === 'cancelled') return { cancelled: true }; // 34.6
      if (out.kind === 'path')
        return { path: this.host === 'wsl' ? await toWslPath(out.path, this.exec) : out.path }; // 34.7
      if (out.kind === 'dryRun') return { cancelled: true };
      throw new PickerFailedError(`${out.message}${r.stderr ? ` (${r.stderr.trim().slice(0, 300)})` : ''}`);
    } finally {
      this.inFlight = false;
    }
  }
}

/** 어떤 피커든 동시 1개로 제한 (34.8) */
export function singleFlight(inner: Pick<FolderPicker, 'pick'>): FolderPicker {
  let inFlight = false;
  return {
    get busy() {
      return inFlight;
    },
    async pick(o) {
      if (inFlight) throw new PickerBusyError();
      inFlight = true;
      try {
        return await inner.pick(o);
      } finally {
        inFlight = false;
      }
    },
  };
}
