import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { CommandHost } from './plan.js';

/**
 * 외부 명령 실행기. 설치 관리자의 모든 외부 명령은 이 함수 형태로 주입받는다(테스트는 모킹).
 * - host 'windows' 명령을 WSL에서 실행하면 `cmd.exe /c <명령>`으로 감싼다 (powershell.exe는 그대로).
 * - host 'linux' 명령을 Windows에서 실행하면 `wsl.exe -e <명령>`으로 감싼다.
 * - 출력은 onOutput으로 흘려보낸다(터미널 패널 스트림). 시간 제한·취소(AbortSignal) 시 프로세스를 죽인다.
 */

export type HostPlatform = 'windows' | 'wsl' | 'posix';

export interface CommandSpec {
  file: string;
  args: string[];
  /** 실행 위치 (기본: 현재 호스트 그대로) */
  host?: CommandHost;
  cwd?: string;
  env?: Record<string, string>;
}

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  onOutput?: (stream: 'stdout' | 'stderr', data: string) => void;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  /** 실행 자체가 실패한 경우(ENOENT 등) */
  error?: string;
}

export type Runner = (cmd: CommandSpec, opts?: RunOptions) => Promise<RunResult>;

/** 현재 호스트: Windows / WSL / 그 밖의 유닉스 */
export function detectHostPlatform(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  procVersion?: string,
): HostPlatform {
  if (platform === 'win32') return 'windows';
  if (platform !== 'linux') return 'posix';
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return 'wsl';
  let v = procVersion;
  if (v === undefined) {
    try {
      v = readFileSync('/proc/version', 'utf8');
    } catch {
      v = '';
    }
  }
  return /microsoft|wsl/i.test(v) ? 'wsl' : 'posix';
}

export class HostUnavailableError extends Error {
  readonly code = 'HOST_UNAVAILABLE';
  constructor(host: CommandHost, platform: HostPlatform) {
    super(
      `이 컴퓨터(${platform})에서는 ${host === 'windows' ? 'Windows' : '리눅스'} 명령을 실행할 수 없어요.`,
    );
  }
}

/** 실행 위치에 맞게 감싼 실제 명령 */
export function toNativeCommand(cmd: CommandSpec, platform: HostPlatform): { file: string; args: string[] } {
  const host = cmd.host;
  if (!host) return { file: cmd.file, args: cmd.args };
  if (host === 'windows') {
    if (platform === 'windows') return { file: cmd.file, args: cmd.args };
    if (platform !== 'wsl') throw new HostUnavailableError(host, platform);
    // powershell.exe·cmd.exe·*.exe는 WSL interop으로 직접 실행, 그 밖(winget 별칭·*.cmd 심)은 cmd.exe /c
    if (/^(powershell|pwsh|cmd)(\.exe)?$/i.test(cmd.file))
      return { file: cmd.file.toLowerCase().endsWith('.exe') ? cmd.file : `${cmd.file}.exe`, args: cmd.args };
    return { file: 'cmd.exe', args: ['/c', cmd.file, ...cmd.args] };
  }
  // linux
  if (platform === 'windows') return { file: 'wsl.exe', args: ['-e', cmd.file, ...cmd.args] };
  return { file: cmd.file, args: cmd.args };
}

const MAX_KEEP = 256 * 1024;

export function createRunner(platform: HostPlatform = detectHostPlatform()): Runner {
  return (cmd, opts = {}) =>
    new Promise((resolve) => {
      let native: { file: string; args: string[] };
      try {
        native = toNativeCommand(cmd, platform);
      } catch (err) {
        resolve({
          code: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          cancelled: false,
          error: (err as Error).message,
        });
        return;
      }
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let cancelled = false;
      let done = false;
      const child = spawn(native.file, native.args, {
        cwd: cmd.cwd,
        env: cmd.env ? { ...process.env, ...cmd.env } : process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const kill = () => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* 이미 끝남 */
        }
      };
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            kill();
          }, opts.timeoutMs)
        : undefined;
      const onAbort = () => {
        cancelled = true;
        kill();
      };
      if (opts.signal?.aborted) onAbort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (b: Buffer) => {
        const s = b.toString('utf8');
        if (stdout.length < MAX_KEEP) stdout += s;
        opts.onOutput?.('stdout', s);
      });
      child.stderr.on('data', (b: Buffer) => {
        const s = b.toString('utf8');
        if (stderr.length < MAX_KEEP) stderr += s;
        opts.onOutput?.('stderr', s);
      });
      const finish = (code: number | null, error?: string) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        resolve({
          code: timedOut || cancelled ? null : code,
          stdout,
          stderr,
          timedOut,
          cancelled,
          ...(error ? { error } : timedOut ? { error: `시간 초과 (${opts.timeoutMs}ms)` } : {}),
        });
      };
      child.on('error', (e) => finish(null, e.message));
      child.on('close', (code) => finish(code));
    });
}

/** 테스트용 모킹 실행기: (명령 원문) → 결과. 호출 기록을 남긴다 */
export interface MockCall {
  line: string;
  cmd: CommandSpec;
}

export type MockReply =
  | Partial<RunResult>
  | ((cmd: CommandSpec, opts: RunOptions) => Partial<RunResult> | Promise<Partial<RunResult>>);

export function mockRunner(
  replies: Record<string, MockReply> | ((line: string, cmd: CommandSpec) => MockReply | undefined),
): Runner & { calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fn = (async (cmd: CommandSpec, opts: RunOptions = {}) => {
    const line = [cmd.file, ...cmd.args].join(' ');
    calls.push({ line, cmd });
    let r: MockReply | undefined;
    if (typeof replies === 'function') r = replies(line, cmd);
    else {
      r = replies[line];
      if (r === undefined) {
        // 가장 긴 접두어 일치
        const key = Object.keys(replies)
          .filter((k) => line.startsWith(k))
          .sort((a, b) => b.length - a.length)[0];
        if (key) r = replies[key];
      }
    }
    const v = typeof r === 'function' ? await r(cmd, opts) : r;
    const res: RunResult = {
      stdout: '',
      stderr: '',
      timedOut: false,
      cancelled: false,
      ...(v ? { code: 0 } : { code: 127, error: 'not found' }),
      ...(v ?? {}),
    };
    if (res.stdout) opts.onOutput?.('stdout', res.stdout);
    if (res.stderr) opts.onOutput?.('stderr', res.stderr);
    return res;
  }) as Runner & { calls: MockCall[] };
  fn.calls = calls;
  return fn;
}
