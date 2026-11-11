import { describe, expect, it } from 'vitest';
import {
  StageStallDetector,
  advanceStage,
  buildSkeleton,
  completeStage,
  markItemsDone,
  type StageTree,
} from '../src/index.js';
import { FIXED_NOW, THREE, templates } from './stages-helpers.js';

const start = () =>
  advanceStage(
    buildSkeleton({ sessionId: 's', agent: { name: 'three', pipeline: THREE }, templates, now: FIXED_NOW }),
    'plan',
    'running',
  );

const touch = (t: StageTree, stageId: string): StageTree => {
  const n = structuredClone(t);
  const s = n.stages.find((x) => x.stageId === stageId)!;
  s.items[0]!.evidence.push({ kind: 'note', summary: '진척' });
  return n;
};

describe('4F.2 정체 감지 단계별', () => {
  it('같은 단계에서 무변화 2턴 → 접근 변경, 3턴 → 막힘', () => {
    const d = new StageStallDetector();
    const t = start();
    expect(d.observeTurn(t).action).toBe('none');
    expect(d.observeTurn(t).action).toBe('none');
    const a2 = d.observeTurn(t);
    expect(a2).toMatchObject({
      action: 'change_approach',
      stageId: 'plan',
      itemId: 'plan1',
      unchangedTurns: 2,
    });
    const a3 = d.observeTurn(t);
    expect(a3).toMatchObject({ action: 'blocked', stageId: 'plan', unchangedTurns: 3 });
  });

  it('진척(증거)이 생기면 0부터', () => {
    const d = new StageStallDetector();
    let t = start();
    d.observeTurn(t);
    d.observeTurn(t);
    t = touch(t, 'plan');
    expect(d.observeTurn(t)).toMatchObject({ action: 'none', unchangedTurns: 0 });
  });

  it('단계가 바뀌면 그 단계 기준으로 다시 센다 (앞 단계 무변화 횟수를 넘기지 않음)', () => {
    const d = new StageStallDetector();
    let t = start();
    d.observeTurn(t);
    d.observeTurn(t);
    expect(d.observeTurn(t).action).toBe('change_approach');
    t = markItemsDone(t, 'plan');
    t = completeStage(t, 'plan', { handoff: { output: { screens: 1 }, summary: '끝' } }).tree;
    t = advanceStage(t, 'build', 'running');
    expect(d.observeTurn(t)).toMatchObject({ action: 'none', stageId: 'build', unchangedTurns: 0 });
    expect(d.observeTurn(t)).toMatchObject({ action: 'none', stageId: 'build', unchangedTurns: 1 });
    expect(d.counts.get('plan')).toBe(2);
  });
});
