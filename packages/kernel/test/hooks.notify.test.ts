import { describe, expect, it } from 'vitest';
import { HookBus } from '../src/hooks.js';

describe('알림형 훅', () => {
  it('예외 던지는 훅이 있어도 본 흐름 완료', async () => {
    const bus = new HookBus();
    const seen: string[] = [];
    bus.onNotify('turn.end', () => {
      throw new Error('sync boom');
    });
    bus.onNotify('turn.end', async () => {
      await Promise.resolve();
      throw new Error('async boom');
    });
    bus.onNotify('turn.end', () => void seen.push('ok'));
    let flowDone = false;
    const p = bus.emit('turn.end', { sessionId: 's1' });
    flowDone = true; // emit은 동기적으로 반환되고 예외를 던지지 않는다
    const recs = await p;
    expect(flowDone).toBe(true);
    expect(seen).toEqual(['ok']);
    expect(recs.map((r) => r.decision).sort()).toEqual(['error', 'error', 'ok']);
  });
});
