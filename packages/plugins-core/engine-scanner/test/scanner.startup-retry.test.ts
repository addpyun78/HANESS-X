import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineScanner } from '../src/scanner.js';

const claude = {
  name: 'claude',
  location: 'linux',
  path: '/bin/claude',
  version: '2.0.0',
  status: 'ok',
} as const;

describe('시작 스캔이 비면 1번 더 스캔 (WSL 첫 PATH 조회 시간 초과 대비)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'hx-scan-retry-'));
    dirs.push(d);
    return join(d, 'engines.json');
  };

  it('첫 결과 0개 → startupRetryMs 뒤 재스캔해서 찾음', async () => {
    vi.useFakeTimers();
    const scanEngines = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([claude]);
    const s = new EngineScanner({
      cacheFile: tmp(),
      scanEngines,
      probeLocalLlms: async () => [],
      startupRetryMs: 1000,
    });
    const first = await s.start();
    expect(first.engines).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(scanEngines).toHaveBeenCalledTimes(2);
    expect(s.last?.engines.map((e) => e.name)).toEqual(['claude']);
    s.stop();
  });

  it('첫 결과에 엔진이 있으면 재스캔하지 않음, stop()이면 예약 취소', async () => {
    vi.useFakeTimers();
    const found = vi.fn().mockResolvedValue([claude]);
    const a = new EngineScanner({
      cacheFile: tmp(),
      scanEngines: found,
      probeLocalLlms: async () => [],
      startupRetryMs: 1000,
    });
    await a.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(found).toHaveBeenCalledTimes(1);
    a.stop();
    const empty = vi.fn().mockResolvedValue([]);
    const b = new EngineScanner({
      cacheFile: tmp(),
      scanEngines: empty,
      probeLocalLlms: async () => [],
      startupRetryMs: 1000,
    });
    await b.start();
    b.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(empty).toHaveBeenCalledTimes(1);
  });
});
