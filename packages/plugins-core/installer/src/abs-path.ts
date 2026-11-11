import { parseCommand, type CommandHost, type InstallPlan } from './plan.js';
import type { RunOptions, RunResult, Runner } from './runner.js';
import type { ToolEntry } from './registry.js';

/**
 * P2-E.6 Windows PATH 문제 근본 대응.
 * 설치 직후 새 PATH는 이미 떠 있는 프로세스(하네스·WSL 세션)에 반영되지 않는다.
 * → 설치가 끝나면 레지스트리(HKLM·HKCU)의 최신 PATH로 실행 파일의 **절대 경로**를 찾아 도구 목록에 저장하고,
 *   실행할 때는 이름 대신 그 절대 경로를 쓴다.
 */

/** 계획 → 실행 파일 이름 (없으면 undefined: 모델·이미지·확장 등) */
export function binNameOf(plan: Pick<InstallPlan, 'kind' | 'target' | 'verify'>): string | undefined {
  switch (plan.kind) {
    case 'winget':
    case 'scoop':
    case 'choco':
      return plan.target.split('.').pop()!.toLowerCase();
    case 'npm-cli':
    case 'python-cli':
    case 'cargo':
    case 'wsl-apt':
      return parseCommand(plan.verify.cmd)[0] ?? plan.target.replace(/^@.*\//, '');
    case 'go':
      return plan.target.split('/').pop();
    default:
      return undefined;
  }
}

/** PowerShell: 레지스트리의 최신 PATH로 Get-Command */
export function freshPathScript(bin: string): string {
  if (!/^[\w.+-]+$/.test(bin)) throw new Error(`잘못된 실행 파일 이름: ${bin}`);
  return (
    "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + " +
    "[Environment]::GetEnvironmentVariable('Path','User'); " +
    `(Get-Command '${bin}' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source`
  );
}

export async function resolveExecutable(
  runner: Runner,
  host: CommandHost,
  bin: string,
): Promise<string | undefined> {
  if (host === 'windows') {
    const r = await runner(
      { file: 'powershell.exe', args: ['-NoProfile', '-Command', freshPathScript(bin)], host: 'windows' },
      { timeoutMs: 30_000 },
    );
    const p = r.stdout.trim().split(/\r?\n/)[0]?.trim();
    return r.code === 0 && p && /^[A-Za-z]:[\\/]/.test(p) ? p : undefined;
  }
  if (!/^[\w.+-]+$/.test(bin)) return undefined;
  // 로그인 셸은 ~/.profile 등을 다시 읽어 새 PATH(~/.local/bin, ~/.cargo/bin …)를 반영한다
  const r = await runner(
    { file: 'sh', args: ['-lc', `command -v '${bin}' || true`], host: 'linux' },
    { timeoutMs: 15_000 },
  );
  const p = r.stdout.trim().split(/\r?\n/).pop()?.trim();
  return p && p.startsWith('/') ? p : undefined;
}

/** Windows 절대 경로인가 (C:\…) */
export function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

/** 도구 목록의 절대 경로로 실행 (PATH에 없어도 동작) */
export function runTool(
  runner: Runner,
  entry: Pick<ToolEntry, 'command' | 'name'>,
  args: string[],
  opts?: RunOptions,
): Promise<RunResult> {
  if (!entry.command)
    return Promise.resolve({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      cancelled: false,
      error: `${entry.name}은(는) 실행 파일이 없어요.`,
    });
  return runner(
    { file: entry.command, args, host: isWindowsPath(entry.command) ? 'windows' : 'linux' },
    opts,
  );
}
