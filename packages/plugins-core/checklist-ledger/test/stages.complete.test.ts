import { describe, expect, it } from 'vitest';
import {
  advanceStage,
  buildSkeleton,
  completeStage,
  evaluateStage,
  getStage,
  markItemsDone,
  type StageTree,
} from '../src/index.js';
import { FIXED_NOW, P, templates } from './stages-helpers.js';

const PIPE = P({
  name: 'two',
  nodes: [
    {
      id: 'plan',
      type: 'role',
      outputSchema: { type: 'object', required: ['screens'] },
      acceptance: [{ type: 'command', run: 'pnpm test plan' }],
    },
    { id: 'build', type: 'role' },
  ],
  edges: [{ from: 'plan', to: 'build' }],
});

function running(): StageTree {
  const t = buildSkeleton({
    sessionId: 's',
    agent: { name: 'two', pipeline: PIPE },
    templates,
    now: FIXED_NOW,
  });
  return advanceStage(t, 'plan', 'running', FIXED_NOW);
}

describe('4A.5 단계 완료 = 하위 전부 done + 출구 조건(출력 스키마 + 노드 acceptance)', () => {
  it('노드의 outputSchema·acceptance가 출구 조건이 된다', () => {
    const s = getStage(running(), 'plan');
    expect(s.exitCriteria.outputSchema).toEqual({ type: 'object', required: ['screens'] });
    expect(s.exitCriteria.acceptance).toEqual([{ type: 'command', run: 'pnpm test plan', expectExit: 0 }]);
  });

  it('하위 항목이 남으면 done 안 됨 (running으로 돌아감)', () => {
    const r = completeStage(running(), 'plan', {
      handoff: { output: { screens: 3 }, summary: '화면 3개' },
      checkAcceptance: () => true,
      now: FIXED_NOW,
    });
    expect(r.done).toBe(false);
    expect(r.reason).toContain('남은 항목 2개');
    expect(getStage(r.tree, 'plan').status).toBe('running');
  });

  it('하위 전부 done이어도 출력 스키마 실패면 done 안 됨', () => {
    const t = markItemsDone(running(), 'plan', undefined, FIXED_NOW);
    const r = completeStage(t, 'plan', {
      handoff: { output: { nope: 1 }, summary: '요약' },
      checkAcceptance: () => true,
      now: FIXED_NOW,
    });
    expect(r.done).toBe(false);
    expect(r.reason).toContain('screens');
    expect(getStage(r.tree, 'plan').status).toBe('running');
  });

  it('출력은 맞아도 노드 acceptance 실패(또는 검사 방법 없음)면 done 안 됨', () => {
    const t = markItemsDone(running(), 'plan', undefined, FIXED_NOW);
    const h = { output: { screens: 3 }, summary: '요약' };
    expect(completeStage(t, 'plan', { handoff: h, checkAcceptance: () => false }).done).toBe(false);
    expect(completeStage(t, 'plan', { handoff: h }).done).toBe(false);
  });

  it('T-042 검증기를 주입하면 그걸로 본다', () => {
    const t = markItemsDone(running(), 'plan', undefined, FIXED_NOW);
    const r = completeStage(t, 'plan', {
      handoff: { output: { screens: 3 }, summary: '요약' },
      validateOutput: () => ({ ok: false, missing: ['title'] }),
      checkAcceptance: () => true,
    });
    expect(r.reason).toContain('title');
  });

  it('하위 전부 done + 출구 통과면 done, handoff 저장', () => {
    const t = markItemsDone(running(), 'plan', undefined, FIXED_NOW);
    const r = completeStage(t, 'plan', {
      handoff: { output: { screens: 3 }, summary: '화면 3개를 고치기로 했어요' },
      checkAcceptance: () => true,
      now: FIXED_NOW,
    });
    expect(r.done).toBe(true);
    const s = getStage(r.tree, 'plan');
    expect(s.status).toBe('done');
    expect(s.handoff).toMatchObject({ output: { screens: 3 }, summary: '화면 3개를 고치기로 했어요' });
  });

  it('출구 조건이 없는 단계는 하위 전부 done이면 끝', () => {
    let t = advanceStage(running(), 'build', 'running');
    t = markItemsDone(t, 'build');
    expect(evaluateStage(getStage(t, 'build'))).toEqual({ ok: true });
  });
});
