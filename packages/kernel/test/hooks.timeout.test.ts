import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HOOK_TIMEOUT_MS, HookBus } from '../src/hooks.js';

describe('훅 타임아웃', () => {
  afterEach(() => vi.useRealTimers());

  it('20초 걸리는 훅이 10초에 타임아웃 기록', async () => {
    vi.useFakeTimers();
    expect(DEFAULT_HOOK_TIMEOUT_MS).toBe(10_000);
    const bus = new HookBus();
    bus.onBlocking(
      'item.verify',
      () => new Promise((r) => setTimeout(() => r({ decision: 'deny' }), 20_000)),
      {
        id: 'slow',
      },
    );
    const p = bus.runBlocking('item.verify');
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const out = await p;
    expect(out.decision).toBe('allow'); // 기본 failMode
    expect(out.results[0]).toMatchObject({ hookId: 'slow', decision: 'timeout' });
    expect(out.results[0]?.durationMs).toBe(10_000);
  });
});
