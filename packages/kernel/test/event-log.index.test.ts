import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../src/event-log.js';
import { tempDir, textEvent } from './helpers.js';

describe('EventLog SQLite 인덱스', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('itemId·type·sessionId·ts 조회', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const log = new EventLog({ root: t.dir });
    log.append(textEvent('s1', 'a', { itemId: 'item-1' }));
    log.append(textEvent('s1', 'b', { itemId: 'item-2' }));
    log.append(textEvent('s2', 'c', { itemId: 'item-1' }));
    log.append({
      id: 'u1',
      ts: '2026-11-10T05:00:00.000Z',
      sessionId: 's2',
      itemId: 'item-1',
      type: 'usage',
      inputTokens: 1,
      outputTokens: 2,
    });

    const byItem = log.query({ itemId: 'item-1' });
    expect(byItem.map((e) => e.sessionId)).toEqual(['s1', 's2', 's2']);
    expect(byItem.every((e) => e.itemId === 'item-1')).toBe(true);
    expect(log.query({ itemId: 'item-1', sessionId: 's2', type: 'usage' }).map((e) => e.id)).toEqual(['u1']);
    expect(log.query({ since: '2026-11-10T04:00:00.000Z' }).map((e) => e.id)).toEqual(['u1']);
    expect(log.sessions()).toEqual(['s1', 's2']);
    log.close();

    // 다시 열어도 인덱스 유지
    const again = new EventLog({ root: t.dir });
    expect(again.query({ itemId: 'item-2' }).map((e) => e.text)).toEqual(['b']);
    again.close();
  });
});

describe('EventLog 인덱스 재구성', () => {
  it('rebuildIndex가 JSONL에서 인덱스를 복구', () => {
    const t = tempDir();
    const log = new EventLog({ root: t.dir });
    for (let i = 0; i < 20; i++) log.append(textEvent('r1', `x${i}`, { itemId: i % 2 ? 'odd' : 'even' }));
    expect(log.rebuildIndex('r1')).toBe(20);
    expect(log.query({ sessionId: 'r1', itemId: 'odd' })).toHaveLength(10);
    log.close();
    t.cleanup();
  });
});
