// @features F-109
import { buildSkeleton, decideStageStop, getStage } from '@harness-x/checklist-ledger';
import { describe, expect, it } from 'vitest';
import { ROUTE } from './stages-pipelines.js';
import { runWithStages, statuses } from './stages-run.js';

describe('4E.3 분기(router): 고르지 않은 길의 단계는 skipped + 이유', () => {
  it('뼈대: 두 길 모두 예상, 갈래 표시', () => {
    const t = buildSkeleton({ sessionId: 's', agent: { name: 'route', pipeline: ROUTE } });
    expect(t.stages.map((s) => [s.stageId, s.route?.to ?? null])).toEqual([
      ['look', null],
      ['big', 'big'],
      ['small', 'small'],
      ['end', null],
    ]);
  });

  it.each([
    ['big', 'small'],
    ['small', 'big'],
  ])('%s를 고르면 %s는 건너뜀', async (chosen, other) => {
    const before: Record<string, string>[] = [];
    const { r, tree } = await runWithStages({
      pipeline: ROUTE,
      outputs: (node) =>
        node === 'look' ? { size: chosen, summary: '살펴봤어요.' } : { summary: '마쳤어요.' },
      onTurn: (node, t) => node === 'look' && before.push(statuses(t)),
    });
    expect(r.status).toBe('completed');
    expect(before[0]).toMatchObject({ big: 'expected', small: 'expected' });
    expect(getStage(tree, other)).toMatchObject({
      status: 'skipped',
      reason: `다른 길(${chosen})을 골라서 건너뛰었어요.`,
    });
    expect(getStage(tree, chosen).status).toBe('done');
    expect(decideStageStop(tree).decision).toBe('allow');
  });
});
