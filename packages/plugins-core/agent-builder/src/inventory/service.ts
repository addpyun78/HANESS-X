import { EventEmitter } from 'node:events';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import { buildInventory, type InventorySources } from './build.js';
import type { Inventory } from './schema.js';

/**
 * P4-A.10 인벤토리 캐시·갱신
 * - 기본 5분 캐시
 * - 플러그인 핫리로드(reloaded·added·failed) / 엔진 재스캔(engines.json 변경) 이벤트가 오면 즉시 새 스냅샷
 *
 * 이벤트: 'snapshot' (Inventory, reason)
 */

export const INVENTORY_TTL_MS = 5 * 60 * 1000;
/** HotReloader가 내는 플러그인 변경 이벤트 */
export const PLUGIN_CHANGE_EVENTS = ['reloaded', 'added', 'failed', 'removed'] as const;

export interface InventoryServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

/** on/off가 있는 이벤트 발신자 (kernel HotReloader 등) */
export interface EventSource {
  on(event: string, fn: (...args: unknown[]) => void): unknown;
  off?(event: string, fn: (...args: unknown[]) => void): unknown;
}

export class InventoryService extends EventEmitter {
  private current: Inventory | undefined;
  private builtAt = 0;
  private pending: Promise<Inventory> | undefined;
  private dirty = false;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly sources: InventorySources = {},
    opts: InventoryServiceOptions = {},
  ) {
    super();
    this.ttlMs = opts.ttlMs ?? INVENTORY_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** 캐시가 살아 있으면 그대로, 아니면 새로 만든다 */
  async get(): Promise<Inventory> {
    if (this.current && !this.dirty && this.now() - this.builtAt < this.ttlMs) return this.current;
    return this.refresh('ttl');
  }

  /** 지금 스냅샷 (없으면 undefined) */
  peek(): Inventory | undefined {
    return this.current;
  }

  /** 새 스냅샷 만들기 (동시에 여러 번 불려도 한 번만 만든다) */
  refresh(reason = 'manual'): Promise<Inventory> {
    if (this.pending) {
      // 만드는 도중 무효화가 오면 끝난 뒤 한 번 더
      if (reason !== 'ttl') this.dirty = true;
      return this.pending;
    }
    this.dirty = false;
    this.pending = buildInventory(this.sources)
      .then((inv) => {
        this.current = inv;
        this.builtAt = this.now();
        this.emit('snapshot', inv, reason);
        return inv;
      })
      .finally(() => {
        this.pending = undefined;
        if (this.dirty) void this.refresh('dirty').catch((err: unknown) => this.emit('error', err));
      });
    return this.pending;
  }

  /** 캐시 무효화 + 즉시 다시 만들기 */
  invalidate(reason: string): void {
    this.dirty = true;
    void this.refresh(reason).catch((err: unknown) => this.emit('error', err));
  }

  /** 플러그인 핫리로드 이벤트에 연결 */
  attachHotReload(src: EventSource, events: readonly string[] = PLUGIN_CHANGE_EVENTS): void {
    for (const ev of events) {
      const fn = () => this.invalidate(`plugin:${ev}`);
      src.on(ev, fn);
      this.disposers.push(() => src.off?.(ev, fn));
    }
  }

  /** 엔진 재스캔 = engines.json 갱신 → 감시 (폴더 단위 watch: 원자적 rename도 잡는다) */
  watchEnginesCache(file: string): void {
    const dir = dirname(file);
    if (!existsSync(dir)) return;
    const name = basename(file);
    let w: FSWatcher;
    try {
      w = watch(dir, (_ev, f) => {
        if (!f || String(f) === name) this.invalidate('engines:rescan');
      });
    } catch {
      return;
    }
    w.on('error', () => undefined);
    this.disposers.push(() => w.close());
  }

  /** 엔진 재스캔 이벤트를 직접 받는 경우 (예: POST /api/engines/rescan 완료 알림) */
  attachEngineRescan(src: EventSource, event = 'scanned'): void {
    const fn = () => this.invalidate('engines:rescan');
    src.on(event, fn);
    this.disposers.push(() => src.off?.(event, fn));
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
    this.removeAllListeners();
  }
}
