import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChecklistLedger,
  StageTreeStore,
  decideStageStop,
  decideStop,
  getStage,
  statusOf,
} from '@harness-x/checklist-ledger';
import { describe, expect, it } from 'vitest';
import { StageTracker } from '../src/index.js';
import { items } from './runner-helpers.js';
import { LOOP, MINI, ROUTE, THREE } from './stages-pipelines.js';
import { FIXED_NOW, runWithStages, statuses, templates } from './stages-run.js';

/**
 * 4G.0 설계 표의 5가지 상황 — 단계 뼈대를 만드는 시점과 근거
 */
describe('4G.0 단계 뼈대를 만드는 시점과 근거 (5가지 상황)', () => {
  it('① `/`로 3단계 에이전트 실행 → 실행 버튼을 누른 순간 3단계 뼈대', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-g0-'));
    try {
      const store = new StageTreeStore({ dir, sessionId: 's', now: FIXED_NOW });
      const tracker = new StageTracker({
        sessionId: 's',
        agent: { name: 'three', pipeline: THREE },
        templates,
        store,
      });
      // 에이전트를 골랐지만 실행 전 → 트리 없음
      expect(store.read()).toBeNull();
      tracker.start(); // 실행 버튼
      expect(store.read()!.stages.map((s) => [s.stageId, s.status])).toEqual([
        ['plan', 'expected'],
        ['build', 'expected'],
        ['test', 'expected'],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('② 에이전트 없이 지시 → 단계 1개, T-100 동작과 결과 동일', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-g0-'));
    try {
      const ledger = new ChecklistLedger({ dir, sessionId: 's', now: FIXED_NOW });
      ledger.create(items('t', 3));
      const store = new StageTreeStore({ dir, sessionId: 's', now: FIXED_NOW });
      const t = store.start({}); // 지시를 보낸 순간
      expect(t.stages).toHaveLength(1);
      expect(t.stages[0]).toMatchObject({ stageId: 'task', title: '작업' });
      // 진행하면서 매번 기존 판단과 같다
      for (const id of ['t1', 't2', 't3']) {
        const tree = store.load()!;
        const a = decideStop(statusOf('s', ledger.read()));
        const b = decideStageStop(tree);
        expect(b.decision).toBe(a.decision);
        expect(b.reason).toBe(a.reason);
        ledger.transition(id, 'doing');
        ledger.transition(id, 'verifying');
        ledger.transition(id, 'done');
      }
      expect(decideStageStop(store.load()!).decision).toBe('allow');
      expect(decideStop(statusOf('s', ledger.read())).decision).toBe('allow');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('③ 분기 에이전트 → 도착 전엔 두 길 모두 "예상", 도착 후 안 고른 길 "건너뜀"', async () => {
    const before: Record<string, string>[] = [];
    const { tree } = await runWithStages({
      pipeline: ROUTE,
      outputs: (n) => (n === 'look' ? { size: 'big', summary: '살펴봤어요.' } : { summary: '마쳤어요.' }),
      onTurn: (n, t) => n === 'look' && before.push(statuses(t)),
    });
    expect(before[0]).toMatchObject({ big: 'expected', small: 'expected' });
    expect(statuses(tree)).toMatchObject({ big: 'done', small: 'skipped' });
  });

  it('④ 반복 에이전트 → 회차가 돌 때마다 1개씩 추가', async () => {
    const counts: number[] = [];
    await runWithStages({
      pipeline: LOOP(3),
      outputs: (n) => (n === 'fix' ? { ok: false, summary: '고쳤어요.' } : { summary: '마쳤어요.' }),
      onTurn: (n, t) => n === 'fix' && counts.push(getStage(t, 'again').children.length),
    });
    // 회차 1 시작: 1·2(예상) / 회차 2: 1·2·3(예상) / 회차 3: 최대라 더 늘지 않음
    expect(counts).toEqual([2, 3, 3]);
  });

  it('⑤ 실행 중 `/` 호출 → 현재 단계 아래에 그 에이전트 트리 추가', async () => {
    const tracker = new StageTracker({
      sessionId: 's',
      agent: { name: 'three', pipeline: THREE },
      templates,
      now: FIXED_NOW,
    });
    tracker.start();
    const h = tracker.hooks();
    await h.nodeStart!({ node: THREE.nodes[0]!, visit: 1, engineId: 'fake' });
    expect(tracker.tree.stages[0]!.status).toBe('running');
    tracker.callAgent('mini', MINI);
    const plan = getStage(tracker.tree, 'plan');
    expect(plan.children.map((c) => [c.stageId, c.kind])).toEqual([['plan.mini', 'subagent']]);
    expect(plan.children[0]!.children.map((c) => c.stageId)).toEqual(['plan.mini.draft', 'plan.mini.polish']);
    // 다른 단계에는 손대지 않는다
    expect(tracker.tree.stages.map((s) => s.stageId)).toEqual(['plan', 'build', 'test']);
  });
});
