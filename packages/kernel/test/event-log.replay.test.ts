import { afterEach, describe, expect, it } from 'vitest';
import { EventLog, type LogRecord } from '../src/event-log.js';
import { tempDir, textEvent } from './helpers.js';

describe('EventLog.replay', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('기록한 것과 재생한 것이 깊은 비교로 일치', async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const log = new EventLog({ root: t.dir });
    const written: LogRecord[] = [];
    for (let i = 0; i < 50; i++) written.push(log.append(textEvent('s1', `텍스트 ${i}`)));
    written.push(
      log.append({
        id: 'tc1',
        ts: '2026-11-10T01:00:00.000Z',
        sessionId: 's1',
        type: 'tool_call',
        callId: 'c1',
        tool: 'Write',
        input: { path: 'harness/mobile/a.kt', nested: [1, { a: null }] },
      }),
    );
    log.append(textEvent('other', '다른 세션'));
    const replayed: LogRecord[] = [];
    for await (const e of log.replay('s1')) replayed.push(e);
    expect(replayed).toStrictEqual(written);
    log.close();
  });

  it('없는 세션은 빈 재생', async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const log = new EventLog({ root: t.dir });
    const out = [];
    for await (const e of log.replay('none')) out.push(e);
    expect(out).toEqual([]);
    log.close();
  });
});
