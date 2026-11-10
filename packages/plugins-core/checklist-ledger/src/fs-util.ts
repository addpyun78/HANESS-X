import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/** 쓰기 → fsync → rename → 디렉터리 fsync. 중간에 죽어도 이전 파일 또는 새 파일 중 하나만 남는다 */
export function writeFileAtomic(file: string, data: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    const buf = Buffer.from(data, 'utf8');
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSafe(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  fsyncDir(dirname(file));
}

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

function fsyncSafe(fd: number): void {
  try {
    fsyncSync(fd);
  } catch {
    /* 일부 파일시스템은 fsync 미지원 */
  }
}

function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    /* Windows·일부 FS는 디렉터리 fsync 불가 */
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export class LockBusyError extends Error {
  readonly code = 'LOCK_BUSY';
  constructor(readonly lockFile: string) {
    super(`잠금 파일이 사용 중입니다: ${lockFile}`);
    this.name = 'LockBusyError';
  }
}

export interface LockOptions {
  /** 잠금 대기 최대 시간 (기본 2000ms) */
  waitMs?: number;
  /** 이보다 오래된 잠금은 죽은 프로세스의 것으로 보고 제거 (기본 30000ms) */
  staleMs?: number;
}

const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms: number): void {
  Atomics.wait(sleepBuf, 0, 0, ms);
}

/**
 * O_EXCL 잠금 파일로 프로세스 간 상호 배제. read-compare-write 구간을 감싼다.
 * 동기 함수이므로 같은 프로세스 안에서는 끼어들 수 없다.
 */
export function withFileLock<T>(lockFile: string, fn: () => T, opts: LockOptions = {}): T {
  const waitMs = opts.waitMs ?? 2000;
  const staleMs = opts.staleMs ?? 30_000;
  mkdirSync(dirname(lockFile), { recursive: true });
  const deadline = Date.now() + waitMs;
  let fd: number | undefined;
  for (;;) {
    try {
      fd = openSync(lockFile, 'wx');
      writeSync(fd, String(process.pid));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        if (Date.now() - statSync(lockFile).mtimeMs > staleMs) {
          rmSync(lockFile, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) throw new LockBusyError(lockFile);
      sleepSync(10);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lockFile, { force: true });
  }
}

export function siblingFile(file: string, name: string): string {
  return join(dirname(file), name);
}
