import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EngineScanner,
  EnginesCacheSchema,
  registerRescanRoute,
  RESCAN_INTERVAL_MS,
  RESCAN_ROUTE,
  type EngineEntry,
} from '@harness-x/engine-scanner';
import { tempDir } from './helpers.js';

function fakeSources() {
  let n = 0;
  const scanEngines = vi.fn(async (): Promise<EngineEntry[]> => {
    n++;
    return [
      {
        name: 'claude',
        location: 'linux',
        path: '/bin/claude',
        version: `2.0.${n}`,
        minVersion: '2.0.0',
        status: 'ok',
      },
    ];
  });
  const probeLocalLlms = vi.fn(async () => []);
  return { scanEngines, probeLocalLlms };
}

describe('12.5 시작 시 1회 + 30분 주기 + POST /api/engines/rescan', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => {
    t = tempDir();
  });
  afterEach(() => {
    vi.useRealTimers();
    t.cleanup();
  });

  it('start: 즉시 1회, 이후 30분마다 재스캔, stop 후 중단', async () => {
    vi.useFakeTimers();
    const src = fakeSources();
    const s = new EngineScanner({ cacheFile: join(t.dir, 'engines.json'), ...src });
    await s.start();
    expect(src.scanEngines).toHaveBeenCalledTimes(1);
    expect(RESCAN_INTERVAL_MS).toBe(1_800_000);
    await vi.advanceTimersByTimeAsync(RESCAN_INTERVAL_MS - 1);
    expect(src.scanEngines).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(src.scanEngines).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RESCAN_INTERVAL_MS);
    expect(src.scanEngines).toHaveBeenCalledTimes(3);
    s.stop();
    await vi.advanceTimersByTimeAsync(RESCAN_INTERVAL_MS * 2);
    expect(src.scanEngines).toHaveBeenCalledTimes(3);
    expect(s.running).toBe(false);
  });

  it('POST /api/engines/rescan 호출 시 캐시 파일 갱신', async () => {
    const file = join(t.dir, 'engines.json');
    const src = fakeSources();
    const s = new EngineScanner({ cacheFile: file, ...src });
    await s.start();
    s.stop();
    const before = EnginesCacheSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    expect(before.engines[0]?.version).toBe('2.0.1');

    const app = Fastify();
    registerRescanRoute(app, s);
    try {
      const res = await app.inject({ method: 'POST', url: RESCAN_ROUTE });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; cache: { engines: EngineEntry[] } };
      expect(body.ok).toBe(true);
      expect(body.cache.engines[0]?.version).toBe('2.0.2');
      const after = EnginesCacheSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      expect(after.engines[0]?.version).toBe('2.0.2');
      expect(after).toEqual(s.last);
    } finally {
      await app.close();
    }
  });

  it('동시에 여러 번 요청해도 스캔은 한 번만', async () => {
    const src = fakeSources();
    const s = new EngineScanner({ cacheFile: join(t.dir, 'engines.json'), ...src });
    const [a, b] = await Promise.all([s.scan(), s.scan()]);
    expect(a).toBe(b);
    expect(src.scanEngines).toHaveBeenCalledTimes(1);
  });
});
