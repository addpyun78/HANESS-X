import { randomUUID } from 'node:crypto';
import type { EventLog } from './event-log.js';

/**
 * 훅 버스
 * - 차단형(blocking): 순서대로 실행, 첫 deny/block에서 중단하고 호출자에게 돌려준다.
 * - 알림형(notify): 비동기로 실행, 실패해도 본 흐름은 계속된다.
 * - 모든 훅 실행 결과는 이벤트 로그에 `hook_result`로 기록한다.
 */

// ── 5.1 훅 이름 ────────────────────────────────────────────────
export const HOOK_NAMES = [
  'session.start',
  'prompt.submit',
  'tool.before',
  'tool.after',
  'turn.end',
  'stop.before',
  'context.compact',
  'item.verify',
] as const;
export type HookName = (typeof HOOK_NAMES)[number];

export type HookDecision = 'allow' | 'deny' | 'block';

export interface HookResult {
  decision: HookDecision;
  reason?: string;
  /** 차단형 훅이 입력을 고쳐 쓰게 할 때 (예: 정식 경로로 교정) */
  patch?: Record<string, unknown>;
}

export interface HookContext {
  sessionId?: string;
  itemId?: string;
  engineId?: string;
  [key: string]: unknown;
}

export type BlockingHandler = (ctx: HookContext) => HookResult | void | Promise<HookResult | void>;
export type NotifyHandler = (ctx: HookContext) => void | Promise<void>;

export interface HookRegistration {
  id: string;
  name: HookName;
  mode: 'blocking' | 'notify';
  /** 작을수록 먼저 (기본 100) */
  priority: number;
  timeoutMs: number;
  /** 타임아웃·예외 시 결정 (차단형만, 기본 allow) */
  failMode: 'allow' | 'deny';
  handler: BlockingHandler | NotifyHandler;
  /** 등록한 플러그인 id */
  pluginId?: string;
}

export interface RegisterOptions {
  id?: string;
  priority?: number;
  timeoutMs?: number;
  failMode?: 'allow' | 'deny';
  pluginId?: string;
}

export interface BlockingOutcome extends HookResult {
  /** 결정을 내린 훅 id (allow면 없음) */
  hookId?: string;
  /** 실행된 훅 결과 목록 */
  results: HookRunRecord[];
}

export interface HookRunRecord {
  hookId: string;
  hook: HookName;
  mode: 'blocking' | 'notify';
  decision: HookDecision | 'ok' | 'error' | 'timeout';
  reason?: string;
  durationMs: number;
  pluginId?: string;
}

export interface HookBusOptions {
  log?: EventLog;
  /** 기본 타임아웃 (기본 10초) */
  timeoutMs?: number;
  /** ctx.sessionId가 없을 때 로그에 쓸 세션 (기본 'kernel') */
  defaultSessionId?: string;
}

export const DEFAULT_HOOK_TIMEOUT_MS = 10_000;

class HookTimeout extends Error {
  constructor(ms: number) {
    super(`hook timeout after ${ms}ms`);
  }
}

export class HookBus {
  private readonly regs = new Map<HookName, HookRegistration[]>();
  private readonly log: EventLog | undefined;
  private readonly timeoutMs: number;
  private readonly defaultSessionId: string;
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(opts: HookBusOptions = {}) {
    this.log = opts.log;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
    this.defaultSessionId = opts.defaultSessionId ?? 'kernel';
  }

  onBlocking(name: HookName, handler: BlockingHandler, opts: RegisterOptions = {}): () => void {
    return this.add(name, 'blocking', handler, opts);
  }

  onNotify(name: HookName, handler: NotifyHandler, opts: RegisterOptions = {}): () => void {
    return this.add(name, 'notify', handler, opts);
  }

  /** 특정 플러그인이 등록한 훅 모두 해제 (deactivate용) */
  removePlugin(pluginId: string): number {
    let n = 0;
    for (const [name, list] of this.regs) {
      const keep = list.filter((r) => r.pluginId !== pluginId);
      n += list.length - keep.length;
      this.regs.set(name, keep);
    }
    return n;
  }

  list(name?: HookName): HookRegistration[] {
    if (name) return [...(this.regs.get(name) ?? [])];
    return [...this.regs.values()].flat();
  }

  /** 5.2 차단형 실행: 첫 deny/block에서 중단 */
  async runBlocking(name: HookName, ctx: HookContext = {}): Promise<BlockingOutcome> {
    const results: HookRunRecord[] = [];
    let current: HookContext = { ...ctx };
    const patch: Record<string, unknown> = {};
    for (const reg of this.byMode(name, 'blocking')) {
      const started = Date.now();
      let res: HookResult;
      let recDecision: HookRunRecord['decision'];
      try {
        const out = await withTimeout(
          Promise.resolve().then(() => (reg.handler as BlockingHandler)(current)),
          reg.timeoutMs,
        );
        res = out ?? { decision: 'allow' };
        recDecision = res.decision;
      } catch (err) {
        const timedOut = err instanceof HookTimeout;
        res = { decision: reg.failMode, reason: `${timedOut ? 'timeout' : 'error'}: ${errMsg(err)}` };
        recDecision = timedOut ? 'timeout' : 'error';
      }
      const rec = this.record(reg, current, recDecision, res.reason, Date.now() - started);
      results.push(rec);
      if (res.decision === 'deny' || res.decision === 'block') {
        return { decision: res.decision, reason: res.reason, hookId: reg.id, results, patch: res.patch };
      }
      if (res.patch) {
        Object.assign(patch, res.patch);
        current = { ...current, ...res.patch };
      }
    }
    return Object.keys(patch).length ? { decision: 'allow', results, patch } : { decision: 'allow', results };
  }

  /** 5.3 알림형 실행: 기다리지 않아도 되고, 실패해도 예외를 던지지 않는다 */
  emit(name: HookName, ctx: HookContext = {}): Promise<HookRunRecord[]> {
    const runs = this.byMode(name, 'notify').map(async (reg) => {
      const started = Date.now();
      try {
        await withTimeout(
          Promise.resolve().then(() => (reg.handler as NotifyHandler)(ctx)),
          reg.timeoutMs,
        );
        return this.record(reg, ctx, 'ok', undefined, Date.now() - started);
      } catch (err) {
        const d = err instanceof HookTimeout ? 'timeout' : 'error';
        return this.record(reg, ctx, d, errMsg(err), Date.now() - started);
      }
    });
    const all = Promise.all(runs);
    this.inflight.add(all);
    void all.finally(() => this.inflight.delete(all));
    return all;
  }

  /** 진행 중인 알림형 훅이 모두 끝날 때까지 대기 (종료·테스트용) */
  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  private add(
    name: HookName,
    mode: 'blocking' | 'notify',
    handler: BlockingHandler | NotifyHandler,
    opts: RegisterOptions,
  ): () => void {
    if (!(HOOK_NAMES as readonly string[]).includes(name)) throw new Error(`알 수 없는 훅: ${name}`);
    const reg: HookRegistration = {
      id: opts.id ?? `${opts.pluginId ?? 'hook'}:${name}:${randomUUID().slice(0, 8)}`,
      name,
      mode,
      priority: opts.priority ?? 100,
      timeoutMs: opts.timeoutMs ?? this.timeoutMs,
      failMode: opts.failMode ?? 'allow',
      handler,
      pluginId: opts.pluginId,
    };
    const list = [...(this.regs.get(name) ?? []), reg].sort((a, b) => a.priority - b.priority);
    this.regs.set(name, list);
    return () => {
      this.regs.set(
        name,
        (this.regs.get(name) ?? []).filter((r) => r !== reg),
      );
    };
  }

  private byMode(name: HookName, mode: 'blocking' | 'notify'): HookRegistration[] {
    return (this.regs.get(name) ?? []).filter((r) => r.mode === mode);
  }

  /** 5.5 훅 결과를 이벤트 로그에 기록 */
  private record(
    reg: HookRegistration,
    ctx: HookContext,
    decision: HookRunRecord['decision'],
    reason: string | undefined,
    durationMs: number,
  ): HookRunRecord {
    const rec: HookRunRecord = { hookId: reg.id, hook: reg.name, mode: reg.mode, decision, durationMs };
    if (reason !== undefined) rec.reason = reason;
    if (reg.pluginId) rec.pluginId = reg.pluginId;
    if (this.log) {
      try {
        this.log.append({
          id: randomUUID(),
          ts: new Date().toISOString(),
          sessionId: typeof ctx.sessionId === 'string' ? ctx.sessionId : this.defaultSessionId,
          ...(typeof ctx.engineId === 'string' ? { engineId: ctx.engineId } : {}),
          ...(typeof ctx.itemId === 'string' ? { itemId: ctx.itemId } : {}),
          type: 'hook_result',
          ...rec,
        });
      } catch {
        // 로그 실패는 훅 흐름을 막지 않는다
      }
    }
    return rec;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new HookTimeout(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
