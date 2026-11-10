import { execFile } from 'node:child_process';

/** 외부 명령 실행 결과. stdout/stderr는 원시 바이트(wsl.exe는 UTF-16LE를 내보내므로) */
export interface ExecResult {
  /** 종료 코드 (실행 실패·시간 초과 시 null) */
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  /** 실행 자체가 실패한 경우(ENOENT 등) 사유 */
  error?: string;
}

export interface ExecOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** 테스트에서 모킹할 수 있도록 모든 외부 명령은 이 함수 형태로 주입받는다 */
export type ExecFn = (file: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

/** Windows의 .cmd/.bat 은 셸 없이 실행할 수 없다 (Node 보안 정책) */
function needsShell(file: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
}

export const defaultExec: ExecFn = (file, args, opts = {}) =>
  new Promise((resolve) => {
    const shell = needsShell(file);
    const cmd = shell ? `"${file}"` : file;
    const child = execFile(
      cmd,
      shell ? args.map((a) => `"${a.replace(/"/g, '""')}"`) : args,
      {
        encoding: 'buffer',
        timeout: opts.timeoutMs ?? 0,
        killSignal: 'SIGKILL',
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        shell,
        env: opts.env ?? process.env,
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
        const timedOut = Boolean(e?.killed) && (opts.timeoutMs ?? 0) > 0;
        resolve({
          code: e ? (typeof e.code === 'number' ? e.code : null) : 0,
          stdout: Buffer.from(stdout ?? []),
          stderr: Buffer.from(stderr ?? []),
          timedOut,
          ...(e && typeof e.code !== 'number' ? { error: e.message } : {}),
          ...(timedOut ? { error: `시간 초과 (${opts.timeoutMs}ms)` } : {}),
        });
      },
    );
    child.stdin?.end();
  });

/** 출력 → 줄 목록 (CRLF·빈 줄 제거) */
export function outputLines(buf: Buffer | string): string[] {
  const text = typeof buf === 'string' ? buf : buf.toString('utf8');
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
