import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecFn, ExecResult } from '@harness-x/engine-scanner';

export function tempDir(prefix = 'hx-scan-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function ok(stdout: string | Buffer, code = 0): ExecResult {
  return {
    code,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: Buffer.alloc(0),
    timedOut: false,
  };
}

export const notFound: ExecResult = {
  code: 1,
  stdout: Buffer.alloc(0),
  stderr: Buffer.alloc(0),
  timedOut: false,
};

/** 명령줄(`file arg1 arg2`) → 결과 표로 동작하는 모킹 exec. 호출 기록을 남긴다 */
export function mockExec(table: Record<string, ExecResult | (() => ExecResult | Promise<ExecResult>)>) {
  const calls: { file: string; args: string[]; timeoutMs?: number }[] = [];
  const exec: ExecFn = async (file, args, opts = {}) => {
    calls.push({ file, args, timeoutMs: opts.timeoutMs });
    const key = [file, ...args].join(' ');
    const v = table[key];
    if (!v) return notFound;
    return typeof v === 'function' ? v() : v;
  };
  return { exec, calls };
}
