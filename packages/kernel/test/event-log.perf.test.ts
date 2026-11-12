// @features F-005
import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../src/event-log.js';
import { tempDir, textEvent } from './helpers.js';

describe('EventLog 성능', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('1만 이벤트 쓰기·재생 3초 이내', async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const log = new EventLog({ root: t.dir });
    const events = Array.from({ length: 10_000 }, (_, i) => textEvent('perf', `이벤트 ${i} `.repeat(4)));
    const start = performance.now();
    for (const e of events) log.append(e);
    let n = 0;
    for await (const _e of log.replay('perf')) n++;
    const ms = performance.now() - start;
    log.close();
    console.log(`write+replay 10k: ${ms.toFixed(0)}ms`);
    expect(n).toBe(10_000);
    expect(ms).toBeLessThan(3000);
  }, 20_000);
});
