import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChecklistLedger,
  StageTreeStore,
  decideStageStop,
  decideStop,
  parseItem,
  statusOf,
  treeFromChecklist,
  type Checklist,
} from '../src/index.js';
import { FIXED_NOW, item } from './stages-helpers.js';

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 기존 세션 상태 표본 (T-100 원장 그대로) */
function samples(): { name: string; build: (l: ChecklistLedger) => void }[] {
  return [
    { name: '항목 없음(원장 없음)', build: () => {} },
    { name: '할 일 3개', build: (l) => l.create([item('1'), item('2'), item('3')]) },
    {
      name: '진행 중',
      build: (l) => {
        l.create([item('1'), item('2')]);
        l.transition('1', 'doing');
      },
    },
    {
      name: '모두 완료',
      build: (l) => {
        l.create([item('1')]);
        l.transition('1', 'doing');
        l.transition('1', 'verifying');
        l.transition('1', 'done');
      },
    },
    {
      name: '완료 + 막힘',
      build: (l) => {
        l.create([item('1'), item('2')]);
        l.transition('1', 'doing');
        l.transition('1', 'verifying');
        l.transition('1', 'done');
        l.transition('2', 'blocked');
      },
    },
  ];
}

describe('4A.4 에이전트 없는 세션 = 단계 1개 트리 (기존 원장 마이그레이션)', () => {
  it('기존 세션(checklist.json만 있음)을 불러오면 단계 1개 트리로 바뀌고 종료 판단이 기존과 같다', () => {
    for (const s of samples()) {
      dir = mkdtempSync(join(tmpdir(), 'hx-stage-mig-'));
      const ledger = new ChecklistLedger({ dir, sessionId: 's1', now: FIXED_NOW });
      s.build(ledger);
      const store = new StageTreeStore({ dir, sessionId: 's1', now: FIXED_NOW });
      expect(store.exists()).toBe(false);
      const t = store.load();
      const c = ledger.read();
      if (!c) {
        expect(t, s.name).toBeNull();
        expect(decideStop(statusOf('s1', null)).decision).toBe('allow');
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      expect(store.exists(), s.name).toBe(true);
      expect(t!.agent).toBeNull();
      expect(t!.stages).toHaveLength(1);
      expect(t!.stages[0]).toMatchObject({ stageId: 'task', title: '작업', kind: 'task' });
      expect(t!.stages[0]!.items).toEqual(c.items);
      const before = decideStop(statusOf('s1', c));
      const after = decideStageStop(t!);
      expect(after.decision, s.name).toBe(before.decision);
      if (before.decision === 'block') expect(after.reason).toBe(before.reason);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('원장이 바뀌면 다시 불러올 때 단계 1개 트리 항목도 맞춰진다', () => {
    dir = mkdtempSync(join(tmpdir(), 'hx-stage-mig-'));
    const ledger = new ChecklistLedger({ dir, sessionId: 's1', now: FIXED_NOW });
    ledger.create([item('1')]);
    const store = new StageTreeStore({ dir, sessionId: 's1', now: FIXED_NOW });
    expect(store.load()!.stages[0]!.status).toBe('running');
    ledger.transition('1', 'doing');
    ledger.transition('1', 'verifying');
    ledger.transition('1', 'done');
    const t = store.load()!;
    expect(t.stages[0]!.items[0]!.status).toBe('done');
    expect(t.stages[0]!.status).toBe('done');
    expect(decideStageStop(t).decision).toBe('allow');
  });

  it('treeFromChecklist: 기존 체크리스트 → 단계 1개, 원장 항목 출처 표시', () => {
    const c: Checklist = {
      schemaVersion: 1,
      revision: 1,
      version: 1,
      updatedAt: FIXED_NOW().toISOString(),
      items: [parseItem(item('1'))],
    };
    const t = treeFromChecklist('s1', c, FIXED_NOW);
    expect(t.stages[0]!.itemMeta['1']).toEqual({ origin: 'ledger' });
  });
});
