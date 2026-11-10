import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../src/event-log.js';
import { HookBus } from '../src/hooks.js';
import { tempDir } from './helpers.js';

describe('훅 결과 로그', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('차단형·알림형 결과가 이벤트 로그에 hook_result로 남는다', async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const log = new EventLog({ root: t.dir });
    const bus = new HookBus({ log });
    bus.onBlocking('tool.before', () => ({ decision: 'deny', reason: 'no' }), { id: 'gate', pluginId: 'p1' });
    bus.onNotify('tool.after', () => {}, { id: 'audit' });
    await bus.runBlocking('tool.before', { sessionId: 's1', itemId: 'i1' });
    await bus.emit('tool.after', { sessionId: 's1' });
    const recs = log.query({ sessionId: 's1', type: 'hook_result' });
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      hookId: 'gate',
      hook: 'tool.before',
      decision: 'deny',
      reason: 'no',
      itemId: 'i1',
    });
    expect(recs[1]).toMatchObject({ hookId: 'audit', hook: 'tool.after', decision: 'ok' });
    log.close();
  });
});
