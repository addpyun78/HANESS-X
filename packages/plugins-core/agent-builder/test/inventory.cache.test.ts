import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { writeEnginesCache } from '@harness-x/engine-scanner';
import { HotReloader } from '@harness-x/kernel';
import { join } from 'node:path';
import { INVENTORY_TTL_MS, InventoryService } from '../src/inventory/service.js';
import type { Inventory } from '../src/inventory/schema.js';
import { inventoryEnv, writePlugin } from './inventory-helpers.js';

function nextSnapshot(
  svc: InventoryService,
  ms = 3000,
): Promise<{ inv: Inventory; reason: string; at: number }> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${ms}ms 안에 새 스냅샷이 없음`)), ms);
    svc.once('snapshot', (inv: Inventory, reason: string) => {
      clearTimeout(t);
      res({ inv, reason, at: Date.now() });
    });
  });
}

describe('P4-A.10 인벤토리 캐시·갱신', () => {
  it('기본 5분 캐시: 5분 안에는 같은 스냅샷, 지나면 새로', async () => {
    let now = 1_000_000;
    const svc = new InventoryService({ plugins: () => [], engines: () => null }, { now: () => now });
    const a = await svc.get();
    now += INVENTORY_TTL_MS - 1;
    expect((await svc.get()).snapshotId).toBe(a.snapshotId);
    now += 2;
    expect((await svc.get()).snapshotId).not.toBe(a.snapshotId);
    expect(INVENTORY_TTL_MS).toBe(5 * 60 * 1000);
  });

  it('플러그인 추가(핫리로드) 후 3초 안에 새 스냅샷', async () => {
    const env = inventoryEnv();
    const loader = env.loader();
    await loader.loadAll();
    const svc = new InventoryService({
      plugins: () => loader.plugins.values(),
      engines: () => null,
      home: env.home,
    });
    const hr = new HotReloader(loader, {
      roots: [{ dir: env.pluginRoot, origin: 'workspace' }],
      debounceMs: 100,
    });
    try {
      const before = await svc.get();
      expect(before.plugins.some((p) => p.id === 'fresh')).toBe(false);
      svc.attachHotReload(hr);
      await hr.start();
      const got = nextSnapshot(svc, 3000);
      const start = Date.now();
      writePlugin(env.pluginRoot, {
        id: 'fresh',
        description: '새 플러그인',
        provides: { skill: ['fresh-skill'] },
      });
      const snap = await got;
      expect(snap.at - start).toBeLessThan(3000);
      expect(snap.reason).toBe('plugin:added');
      expect(snap.inv.plugins.some((p) => p.id === 'fresh')).toBe(true);
      expect(snap.inv.skills.some((s) => s.id === 'fresh-skill')).toBe(true);
      // 캐시도 새 스냅샷으로 바뀜
      expect((await svc.get()).snapshotId).toBe(snap.inv.snapshotId);
    } finally {
      await hr.stop();
      svc.dispose();
      env.cleanup();
    }
  });

  it('엔진 재스캔(engines.json 갱신) 후 3초 안에 새 스냅샷', async () => {
    const env = inventoryEnv();
    const file = join(env.home, 'engines.json');
    const cache = (names: string[]) => ({
      version: 1 as const,
      scannedAt: new Date().toISOString(),
      platform: 'linux',
      engines: names.map((name) => ({
        name,
        location: 'linux',
        path: `/bin/${name}`,
        version: '1.0.0',
        status: 'ok' as const,
      })),
    });
    writeEnginesCache(cache(['claude']), file);
    const svc = new InventoryService({ plugins: () => [], home: env.home });
    try {
      expect((await svc.get()).engines.map((e) => e.id)).toEqual(['claude-code']);
      svc.watchEnginesCache(file);
      const got = nextSnapshot(svc, 3000);
      writeEnginesCache(cache(['claude', 'codex']), file);
      const snap = await got;
      expect(snap.reason).toBe('engines:rescan');
      // 연속 이벤트가 와도 최종 스냅샷은 새 목록
      await new Promise((r) => setTimeout(r, 200));
      expect((await svc.get()).engines.map((e) => e.id)).toEqual(['claude-code', 'codex']);
    } finally {
      svc.dispose();
      env.cleanup();
    }
  });

  it('재스캔 이벤트 직접 연결 + 동시 요청은 한 번만 만든다', async () => {
    let builds = 0;
    const svc = new InventoryService({
      plugins: () => {
        builds++;
        return [];
      },
      engines: () => null,
    });
    const [a, b] = await Promise.all([svc.get(), svc.get()]);
    expect(a.snapshotId).toBe(b.snapshotId);
    expect(builds).toBe(1);
    const scanner = new EventEmitter();
    svc.attachEngineRescan(scanner);
    const got = nextSnapshot(svc);
    scanner.emit('scanned');
    expect((await got).reason).toBe('engines:rescan');
    svc.dispose();
  });
});
