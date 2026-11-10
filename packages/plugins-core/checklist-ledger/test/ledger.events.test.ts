import { join } from 'node:path';
import { EventLog } from '@harness-x/kernel';
import { ChecklistChangeEventSchema } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { ChecklistLedger, ItemNotFoundError } from '../src/ledger.js';
import { InvalidTransitionError } from '../src/state.js';
import { VersionConflictError } from '../src/store.js';
import { item, tempDir } from './helpers.js';

describe('20.4 checklist_change 이벤트', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  function setup() {
    const t = tempDir();
    const log = new EventLog({ root: join(t.dir, 'logs') });
    cleanup = () => {
      log.close();
      t.cleanup();
    };
    const ledger = new ChecklistLedger({
      dir: join(t.dir, 'ws'),
      sessionId: 's1',
      engineId: 'claude-code',
      log,
    });
    return { log, ledger };
  }

  it('생성·전이·증거 추가마다 이벤트 1개, 이벤트 로그에서 조회', () => {
    const { log, ledger } = setup();
    ledger.create([item('1'), item('2', { deps: ['1'] })]);
    ledger.transition('1', 'doing');
    ledger.transition('1', 'verifying', { evidence: { kind: 'command', summary: 'exit 0' } });
    ledger.addEvidence('1', { kind: 'note', summary: '재확인' });
    ledger.transition('1', 'done', {
      verdict: { level: 1, verdict: 'equal', confidence: 1, reason: 'normalized' },
    });

    const evs = log.query({ sessionId: 's1', type: 'checklist_change' });
    expect(evs.map((e) => [e.changedItemId, e.from, e.to, e.version])).toEqual([
      ['1', null, 'todo', 1],
      ['2', null, 'todo', 1],
      ['1', 'todo', 'doing', 2],
      ['1', 'doing', 'verifying', 3],
      ['1', 'verifying', 'verifying', 4],
      ['1', 'verifying', 'done', 5],
    ]);
    for (const e of evs) {
      expect(ChecklistChangeEventSchema.safeParse(e).success).toBe(true);
      expect(e.engineId).toBe('claude-code');
      expect(e.itemId).toBe(e.changedItemId);
    }
    expect(log.query({ itemId: '2' })).toHaveLength(1);

    const it1 = ledger.item('1');
    expect(it1.status).toBe('done');
    expect(it1.attempts).toBe(1);
    expect(it1.evidence.map((e) => e.kind)).toEqual(['command', 'note']);
    expect(it1.verdict?.verdict).toBe('equal');
  });

  it('거부된 변경은 이벤트를 남기지 않는다', () => {
    const { log, ledger } = setup();
    ledger.create([item('1')]);
    expect(() => ledger.transition('1', 'done')).toThrow(InvalidTransitionError);
    expect(() => ledger.transition('9', 'doing')).toThrow(ItemNotFoundError);
    expect(() => ledger.transition('1', 'doing', { expectedVersion: 7 })).toThrow(VersionConflictError);
    expect(() => ledger.create([item('1')])).toThrow(VersionConflictError);
    expect(log.query({ type: 'checklist_change' })).toHaveLength(1);
    expect(ledger.get().version).toBe(1);
  });

  it('failed → doing 재시도 시 attempts 증가, currentItem/nextItems', () => {
    const { ledger } = setup();
    ledger.create([item('1'), item('2', { deps: ['1'] }), item('3'), item('4')]);
    expect(ledger.currentItem()?.id).toBe('1');
    expect(ledger.nextItems().map((i) => i.id)).toEqual(['2', '3', '4']);
    ledger.transition('1', 'doing');
    ledger.transition('1', 'verifying');
    ledger.transition('1', 'failed');
    expect(ledger.currentItem()?.id).toBe('1');
    ledger.transition('1', 'doing');
    expect(ledger.item('1').attempts).toBe(2);
    expect(ledger.remaining()).toHaveLength(4);
  });
});
