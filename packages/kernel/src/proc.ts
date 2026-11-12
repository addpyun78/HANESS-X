import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { EngineErrorCode, HarnessEvent } from '@harness-x/protocol';
import { STOP_NOW_GRACE_MS } from './stop.js';

/**
 * 엔진 어댑터 공용 자식 프로세스 도우미 (EPIC 1)
 * - 공식 바이너리를 수정 없이 자식 프로세스로 실행한다 (프로세스 그룹 단위로 종료 가능)
 * - stdout 줄 단위 읽기, 이벤트 큐, HarnessEvent 공통 필드 생성
 */

export interface SpawnGroupOptions {
  cwd: string;
  /** 주어지지 않으면 process.env */
  env?: Record<string, string | undefined>;
  /** stdin을 열어 둘지 (JSON-RPC 등). 기본 false → /dev/null */
  stdin?: boolean;
}

/** 새 프로세스 그룹(Unix: detached)으로 실행. Windows에서는 taskkill /T로 트리를 종료한다 */
export function spawnGroup(command: string, args: string[], opts: SpawnGroupOptions): ChildProcess {
  return spawn(command, args, {
    cwd: opts.cwd,
    env: (opts.env ?? process.env) as NodeJS.ProcessEnv,
    stdio: [opts.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
}

function alive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * T-101 2A.4 Windows 자식 프로세스까지 종료하는 명령 (`taskkill /pid N /T /F`).
 * Windows가 아니면 undefined (프로세스 그룹 신호를 쓴다)
 */
export function killTreeCommand(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[] } | undefined {
  return platform === 'win32' ? { file: 'taskkill', args: ['/pid', String(pid), '/T', '/F'] } : undefined;
}

/**
 * 프로세스 그룹 전체 종료: SIGTERM → graceMs(기본 3초, 2A.4 지금 멈추기) 안에 안 끝나면 SIGKILL.
 * Windows는 taskkill /T /F로 자식 트리까지. 종료되면 resolve
 */
export async function killGroup(child: ChildProcess, graceMs = STOP_NOW_GRACE_MS): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  const exited = alive(child) ? new Promise<void>((r) => child.once('exit', () => r())) : Promise.resolve();
  const tree = killTreeCommand(pid);
  const signal = (sig: NodeJS.Signals) => {
    if (tree) {
      spawnSync(tree.file, tree.args, { windowsHide: true });
      return;
    }
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        /* 이미 종료 */
      }
    }
  };
  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), graceMs);
  await exited;
  clearTimeout(timer);
  // 리더가 먼저 죽어도 그룹에 남은 손자 프로세스까지 정리
  signal('SIGKILL');
}

/** 스트림을 줄 단위 async iterable로 */
export function readLines(stream: Readable): AsyncIterable<string> {
  return createInterface({ input: stream, crlfDelay: Infinity });
}

/** 단순 비동기 큐: push로 넣고 for await로 꺼낸다. end() 후 남은 것을 다 꺼내면 끝 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private ended = false;

  push(item: T): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    this.ended = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }

  get isEnded(): boolean {
    return this.ended;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => this.waiters.push(r));
      },
    };
  }
}

/** HarnessEvent에서 공통 필드를 뺀 본문 */
export type EventBody = HarnessEvent extends infer E
  ? E extends HarnessEvent
    ? Omit<E, 'id' | 'ts' | 'sessionId' | 'engineId' | 'itemId'>
    : never
  : never;

export interface EventContext {
  sessionId: string;
  engineId: string;
  itemId?: string;
  /** 테스트용 결정적 id/ts */
  newId?: () => string;
  now?: () => string;
}

/** 본문에 공통 필드(id·ts·sessionId·engineId·itemId)를 붙이는 함수 */
export function eventFactory(ctx: EventContext): (body: EventBody) => HarnessEvent {
  const newId = ctx.newId ?? randomUUID;
  const now = ctx.now ?? (() => new Date().toISOString());
  return (body) =>
    ({
      id: newId(),
      ts: now(),
      sessionId: ctx.sessionId,
      engineId: ctx.engineId,
      ...(ctx.itemId ? { itemId: ctx.itemId } : {}),
      ...body,
    }) as HarnessEvent;
}

/** 줄을 JSON으로 파싱 (실패하면 undefined) */
export function tryJson(line: string): unknown {
  const t = line.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** 줄 단위 출력 엔진용 파서 (claude -p stream-json, codex exec --json, agy -p 등) */
export interface LineParser {
  /** stdout 한 줄 → 이벤트 본문들 */
  line(line: string): EventBody[];
  /** stderr 한 줄 (선택) */
  stderrLine?(line: string): EventBody[];
  /** 프로세스 종료 후 (turn_end가 아직 없을 때만 호출) */
  finish(exitCode: number | null, stderr: string): EventBody[];
  /** 엔진 자체 세션 ID */
  sessionId(): string | undefined;
}

export interface LineRunSpec {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  event: (body: EventBody) => HarnessEvent;
  parser: LineParser;
  /** interrupt 시 SIGKILL까지 유예 (기본 STOP_NOW_GRACE_MS = 3000ms) */
  killGraceMs?: number;
}

export interface LineRun {
  events: AsyncIterable<HarnessEvent>;
  engineSessionId(): string | undefined;
  interrupt(): Promise<void>;
  done: Promise<{ exitCode: number | null }>;
}

/** 자식 프로세스를 실행해 stdout 줄을 파서로 HarnessEvent로 바꾼다. 항상 turn_end로 끝난다 */
export function runLineProcess(spec: LineRunSpec): LineRun {
  const q = new AsyncQueue<HarnessEvent>();
  let turnEnded = false;
  let interrupted = false;
  const stderrBuf: string[] = [];
  const push = (bodies: EventBody[]) => {
    for (const b of bodies) {
      if (turnEnded) return;
      q.push(spec.event(b));
      if (b.type === 'turn_end') turnEnded = true;
    }
  };
  const child = spawnGroup(spec.command, spec.args, { cwd: spec.cwd, env: spec.env });
  const stdoutDone = (async () => {
    if (!child.stdout) return;
    for await (const l of readLines(child.stdout)) if (!interrupted) push(spec.parser.line(l));
  })();
  const stderrDone = (async () => {
    if (!child.stderr) return;
    for await (const l of readLines(child.stderr)) {
      if (stderrBuf.length < 200) stderrBuf.push(l);
      if (!interrupted && spec.parser.stderrLine) push(spec.parser.stderrLine(l));
    }
  })();
  let spawnError: Error | undefined;
  const done = new Promise<{ exitCode: number | null }>((resolve) => {
    child.once('error', (err) => {
      spawnError = err;
      resolve({ exitCode: null });
    });
    child.once('close', (code) => resolve({ exitCode: code }));
  }).then(async (r) => {
    await Promise.allSettled([stdoutDone, stderrDone]);
    if (!turnEnded) {
      if (interrupted) push([{ type: 'turn_end', reason: 'interrupted' }]);
      else if (spawnError)
        push([
          {
            type: 'error',
            code: 'engine_crashed',
            message: `${spec.command} 실행 실패: ${spawnError.message}`,
          },
          { type: 'turn_end', reason: 'error' },
        ]);
      else push(spec.parser.finish(r.exitCode, stderrBuf.join('\n')));
    }
    if (!turnEnded)
      push([
        {
          type: 'error',
          code: 'engine_crashed',
          message: `엔진이 결과 없이 종료됨 (exit ${r.exitCode})${stderrBuf.length ? `: ${stderrBuf.slice(-5).join('\n')}` : ''}`,
        },
        { type: 'turn_end', reason: 'error' },
      ]);
    q.end();
    return r;
  });
  const interrupt = async () => {
    if (!alive(child)) return;
    interrupted = true;
    await killGroup(child, spec.killGraceMs);
  };
  if (spec.signal) {
    if (spec.signal.aborted) void interrupt();
    else spec.signal.addEventListener('abort', () => void interrupt(), { once: true });
  }
  return { events: q, engineSessionId: () => spec.parser.sessionId(), interrupt, done };
}

/** 엔진 오류 문구 → 분류 코드 규칙 (첫 일치) */
export type ErrorRule = [RegExp, EngineErrorCode, boolean?];

export function classifyByRules(
  text: string,
  rules: ErrorRule[],
): { code: EngineErrorCode; retryable: boolean } {
  for (const [re, code, retryable] of rules)
    if (re.test(text)) return { code, retryable: retryable ?? false };
  return { code: 'unknown', retryable: false };
}
