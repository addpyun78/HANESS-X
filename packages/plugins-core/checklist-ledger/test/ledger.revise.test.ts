import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '@harness-x/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { ChecklistLedger } from '../src/ledger.js';
import { ChecklistSchema } from '../src/schema.js';
import { VersionConflictError } from '../src/store.js';
import { item, tempDir } from './helpers.js';

describe('20.5 체크리스트 개정', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('v1 → v2 개정 시 checklist.v1.json 보관, 진행 상태 승계, 이벤트 발행', () => {
    const t = tempDir();
    const log = new EventLog({ root: join(t.dir, 'logs') });
    cleanup = () => {
      log.close();
      t.cleanup();
    };
    const dir = join(t.dir, 'ws');
    const ledger = new ChecklistLedger({ dir, sessionId: 's1', log });
    ledger.create([item('1'), item('2')]);
    ledger.transition('1', 'doing');
    const before = ledger.get();

    const v2 = ledger.revise([item('1', { title: '항목 1 다시 구현' }), item('3')], {
      expectedVersion: before.version,
    });
    expect(v2.revision).toBe(2);
    const archive = join(dir, 'checklist.v1.json');
    expect(existsSync(archive)).toBe(true);
    const v1 = ChecklistSchema.parse(JSON.parse(readFileSync(archive, 'utf8')));
    expect(v1).toEqual(before);
    expect(ledger.readRevision(1)).toEqual(before);
    expect(ledger.readRevision(2)?.revision).toBe(2);

    expect(ledger.item('1')).toMatchObject({ status: 'doing', attempts: 1, title: '항목 1 다시 구현' });
    expect(ledger.item('3').status).toBe('todo');

    const evs = log.query({ type: 'checklist_change' }).filter((e) => e.version === v2.version);
    expect(evs.map((e) => [e.changedItemId, e.from, e.to])).toEqual([
      ['1', 'doing', 'doing'],
      ['3', null, 'todo'],
      ['2', 'todo', 'removed'],
    ]);

    // v2 → v3: v2 보관, v1은 그대로
    ledger.revise([item('1')]);
    expect(existsSync(join(dir, 'checklist.v2.json'))).toBe(true);
    expect(ChecklistSchema.parse(JSON.parse(readFileSync(archive, 'utf8')))).toEqual(before);
    expect(() => ledger.revise([item('1')], { expectedVersion: 1 })).toThrow(VersionConflictError);
  });
});
