import type { InstallKind } from './plan.js';

/**
 * P2-E.1 실행 큐 (동시 1개) · P2-E.2 종류별 시간 제한 + 취소
 * 작업은 AbortSignal을 받는다. 취소·시간 초과 시 signal이 abort되고, 작업(실행기)이 프로세스를 죽인다.
 */

const MIN = 60_000;
/** E.2 종류별 시간 제한 */
export const KIND_TIMEOUT_MS: Record<InstallKind, number> = {
  winget: 10 * MIN,
  scoop: 10 * MIN,
  choco: 15 * MIN,
  'npm-cli': 10 * MIN,
  'python-cli': 10 * MIN,
  cargo: 30 * MIN,
  go: 20 * MIN,
  'ollama-model': 60 * MIN,
  'mcp-local': 2 * MIN,
  'mcp-remote': 1 * MIN,
  'harness-plugin': 5 * MIN,
  skill: 5 * MIN,
  'vscode-ext': 5 * MIN,
  'docker-image': 30 * MIN,
  'wsl-apt': 30 * MIN,
  'direct-download': 30 * MIN,
  'api-service': 1 * MIN,
};

export type QueueJobState = 'queued' | 'running' | 'done' | 'cancelled' | 'timeout';

export interface QueueJob<T> {
  id: string;
  state: QueueJobState;
  done: Promise<T>;
}

export class TimeoutAbort extends Error {
  constructor(ms: number) {
    super(`시간 제한(${Math.round(ms / 1000)}초)을 넘겼어요.`);
    this.name = 'TimeoutAbort';
  }
}

interface Entry {
  id: string;
  timeoutMs: number;
  ctl: AbortController;
  run: (signal: AbortSignal) => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  job: QueueJob<unknown>;
}

export class InstallQueue {
  private readonly waiting: Entry[] = [];
  private current: Entry | undefined;
  /** 실행 순서 기록 (테스트·진단용) */
  readonly order: string[] = [];

  enqueue<T>(id: string, run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): QueueJob<T> {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const done = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const job: QueueJob<unknown> = { id, state: 'queued', done };
    this.waiting.push({ id, timeoutMs, ctl: new AbortController(), run, resolve, reject, job });
    queueMicrotask(() => this.pump());
    return job as QueueJob<T>;
  }

  get running(): string | undefined {
    return this.current?.id;
  }

  get pending(): string[] {
    return this.waiting.map((e) => e.id);
  }

  /** 취소: 대기 중이면 빼고, 실행 중이면 abort (프로세스 종료는 실행기가) */
  cancel(id: string): boolean {
    const i = this.waiting.findIndex((e) => e.id === id);
    if (i >= 0) {
      const [e] = this.waiting.splice(i, 1);
      e!.job.state = 'cancelled';
      e!.ctl.abort();
      e!.reject(Object.assign(new Error('취소했어요.'), { code: 'CANCELLED' }));
      return true;
    }
    if (this.current?.id === id) {
      this.current.job.state = 'cancelled';
      this.current.ctl.abort();
      return true;
    }
    return false;
  }

  private pump(): void {
    if (this.current) return;
    const next = this.waiting.shift();
    if (!next) return;
    this.current = next;
    next.job.state = 'running';
    this.order.push(next.id);
    const timer = setTimeout(() => {
      next.job.state = 'timeout';
      next.ctl.abort(new TimeoutAbort(next.timeoutMs));
    }, next.timeoutMs);
    next
      .run(next.ctl.signal)
      .then(
        (v) => {
          if (next.job.state === 'running') next.job.state = 'done';
          next.resolve(v);
        },
        (e) => next.reject(e),
      )
      .finally(() => {
        clearTimeout(timer);
        this.current = undefined;
        this.pump();
      });
  }
}
