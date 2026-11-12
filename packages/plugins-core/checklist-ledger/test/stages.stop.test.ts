import { HookBus } from '@harness-x/kernel';
import { describe, expect, it } from 'vitest';
import {
  StageStopGuard,
  advanceStage,
  buildSkeleton,
  completeStage,
  decideStageStop,
  markItemsDone,
  setStageStatus,
  type StageTree,
} from '../src/index.js';
import { FIXED_NOW, THREE, templates } from './stages-helpers.js';

function finish(t: StageTree, id: string, output: unknown = { screens: 1 }): StageTree {
  let x = advanceStage(t, id, 'running', FIXED_NOW);
  x = markItemsDone(x, id);
  const r = completeStage(x, id, { handoff: { output, summary: `${id} 끝` }, now: FIXED_NOW });
  if (!r.done) throw new Error(r.reason);
  return r.tree;
}

describe('4A.6 stop-guard: 루트 기준 (모든 단계 done/skipped일 때만 종료)', () => {
  const start = () =>
    buildSkeleton({ sessionId: 's', agent: { name: 'three', pipeline: THREE }, templates, now: FIXED_NOW });

  it('1단계만 끝나고 2단계가 남은 상태 → 종료 차단', () => {
    const t = finish(start(), 'plan');
    const d = decideStageStop(t);
    expect(d.decision).toBe('block');
    expect(d.status.remainingStages.map((s) => s.stageId)).toEqual(['build', 'test']);
    expect(d.reason).toContain('남은 단계 2개');
  });

  it('현재 단계 항목이 모두 끝나도 다음 단계가 남으면 차단', () => {
    let t = finish(start(), 'plan');
    t = markItemsDone(advanceStage(t, 'build', 'running'), 'build');
    expect(decideStageStop(t).decision).toBe('block');
  });

  it('모든 단계 done(또는 skipped)이면 허용', () => {
    let t = finish(finish(start(), 'plan'), 'build');
    expect(decideStageStop(t).decision).toBe('block');
    t = setStageStatus(t, 'test', 'skipped', { reason: '필요 없음' });
    expect(decideStageStop(t)).toMatchObject({ decision: 'allow', reason: '모든 단계 완료' });
  });

  it('차단 뒤 진척이 없으면 사람에게 넘긴다 (기존 규칙과 같음)', () => {
    let tree = finish(start(), 'plan');
    const g = new StageStopGuard(() => tree);
    expect(g.decide(false).decision).toBe('block');
    expect(g.decide(true).decision).toBe('allow');
    tree = advanceStage(tree, 'build', 'running');
    expect(g.decide(true).decision).toBe('block');
  });

  it('stop.before 훅으로 설치', async () => {
    const tree = finish(start(), 'plan');
    const hooks = new HookBus();
    new StageStopGuard(() => tree).install(hooks);
    const r = await hooks.runBlocking('stop.before', { sessionId: 's', stopHookActive: false });
    expect(r.decision).toBe('block');
  });
});
