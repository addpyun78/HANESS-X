import {
  decideStageStop,
  getStage,
  renderStageTreeMarkdown,
  stageProgress,
} from '@harness-x/checklist-ledger';
import { describe, expect, it } from 'vitest';
import { FAN, LOOP, QUAD, SOLO, TRIO } from './stages-pipelines.js';
import { runWithStages, statuses } from './stages-run.js';

/** 4G.1 실행기 + 단계 트리 끝까지 (가짜 엔진, 실제 원장·실행기) */
describe('4G.1 E2E 5종', () => {
  it('단독 에이전트: 단계 1개, 끝나면 종료 허용', async () => {
    const { r, tree } = await runWithStages({ pipeline: SOLO });
    expect(r.status).toBe('completed');
    expect(statuses(tree)).toEqual({ work: 'done' });
    expect(stageProgress(tree).short).toBeNull();
    expect(decideStageStop(tree).decision).toBe('allow');
  });

  it('3단계(plan → build → critic): 단계마다 진행, 진행 중 종료 차단, 끝나면 허용', async () => {
    const mid: string[] = [];
    const { r, tree } = await runWithStages({
      pipeline: TRIO,
      onTurn: (n, t) => mid.push(`${n}:${decideStageStop(t).decision}:${stageProgress(t).short}`),
    });
    expect(r.status).toBe('completed');
    expect(mid).toEqual(['plan:block:단계 1/3', 'build:block:단계 2/3']);
    expect(statuses(tree)).toEqual({ plan: 'done', build: 'done', critic: 'done' });
    expect(tree.stages.map((s) => s.summary)).toEqual([
      '맡은 일을 마쳤어요.',
      '맡은 일을 마쳤어요.',
      '이 단계를 마쳤어요.',
    ]);
    expect(decideStageStop(tree).decision).toBe('allow');
  });

  it('critic 실패 되돌림: 지적받은 build만 재작업 r1, 뒤 단계는 다시 확인 후 통과', async () => {
    const at: Record<string, string>[] = [];
    const { r, tree, calls } = await runWithStages({
      pipeline: QUAD,
      verify: ({ attempt }) =>
        attempt === 0
          ? { failed: [{ nodeId: 'build', itemId: 'build2', reason: '버튼 글자가 작아요' }] }
          : { failed: [] },
      onTurn: (n, t) => at.push({ n, ...statuses(t) }),
    });
    expect(r.status).toBe('completed');
    expect(calls.map((c) => c.node)).toEqual(['plan', 'build', 'doc', 'build']);
    // 재작업 턴: build는 다시 진행, doc은 다시 확인 필요, plan은 그대로
    expect(at[3]).toMatchObject({ n: 'build', plan: 'done', build: 'running', doc: 'needs-recheck' });
    const b = getStage(tree, 'build');
    expect(b.items.map((i) => [i.id, i.status])).toEqual([
      ['build1', 'done'],
      ['build2', 'done'],
      ['build-r1', 'done'],
    ]);
    expect(b.itemMeta['build-r1']).toMatchObject({
      origin: 'rework',
      rework: 1,
      reworkOf: 'build2',
      gateStageId: 'critic',
    });
    expect(statuses(tree)).toEqual({ plan: 'done', build: 'done', doc: 'done', critic: 'done' });
    expect(renderStageTreeMarkdown(tree)).toContain('재작업 r1 — critic 지적');
  });

  it('critic이 3번 실패하면 막힘 + 확인 카드, 종료는 사람에게', async () => {
    const { r, tree, tracker } = await runWithStages({
      pipeline: TRIO,
      verify: () => ({ failed: [{ nodeId: 'build', itemId: 'build1', reason: '계속 틀려요' }] }),
    });
    expect(r.status).toBe('failed');
    expect(getStage(tree, 'critic').status).toBe('blocked');
    expect(
      getStage(tree, 'build')
        .items.filter((i) => i.id.includes('-r'))
        .map((i) => i.id),
    ).toEqual(['build-r1', 'build-r2']);
    expect(tracker.cards.at(-1)).toMatchObject({ kind: 'stage_blocked', stageId: 'critic' });
    expect(decideStageStop(tree).decision).toBe('allow');
  });

  it('병렬 2갈래 + join', async () => {
    const { r, tree } = await runWithStages({ pipeline: FAN });
    expect(r.status).toBe('completed');
    expect(statuses(tree)).toEqual({ web: 'done', mobile: 'done', merge: 'done', ship: 'done' });
  });

  it('반복 3회', async () => {
    const { r, tree, calls } = await runWithStages({
      pipeline: LOOP(3),
      outputs: (n, k) =>
        n === 'fix' ? { ok: k === 2, summary: `${k + 1}번째로 고쳤어요.` } : { summary: '마쳤어요.' },
    });
    expect(r.status).toBe('completed');
    expect(calls.map((c) => c.node)).toEqual(['fix', 'fix', 'fix', 'wrap']);
    expect(getStage(tree, 'again').children.map((c) => [c.title, c.status])).toEqual([
      ['반복 1', 'done'],
      ['반복 2', 'done'],
      ['반복 3', 'done'],
    ]);
    expect(getStage(tree, 'again.3.fix').summary).toBe('3번째로 고쳤어요.');
    expect(decideStageStop(tree).decision).toBe('allow');
  });
});
