import { buildSkeleton, getStage } from '@harness-x/checklist-ledger';
import { describe, expect, it } from 'vitest';
import { LOOP } from './stages-pipelines.js';
import { runWithStages, statuses } from './stages-run.js';

const iterations = (t: Parameters<typeof getStage>[0]) =>
  getStage(t, 'again').children.map((c) => `${c.title}:${c.status}`);

describe('4E.2 반복(loop): 회차별 하위 목록, 종료 시 남은 예상 회차 skipped, 최대 회차', () => {
  it('뼈대에는 반복 1회차만 예상으로', () => {
    const t = buildSkeleton({ sessionId: 's', agent: { name: 'polish', pipeline: LOOP(3) } });
    expect(iterations(t)).toEqual(['반복 1:expected']);
    expect(getStage(t, 'again').children[0]!.children.map((c) => c.stageId)).toEqual(['again.1.fix']);
    expect(getStage(t, 'again').maxIterations).toBe(3);
  });

  it('회차가 돌 때마다 1개씩 추가, 2회차에 끝나면 남은 예상 회차는 건너뜀', async () => {
    const perTurn: string[][] = [];
    const { r, tree } = await runWithStages({
      pipeline: LOOP(3),
      outputs: (node, k) =>
        node === 'fix' ? { ok: k >= 1, summary: '고쳤어요.' } : { summary: '마쳤어요.' },
      onTurn: (node, t) => node === 'fix' && perTurn.push(iterations(t)),
    });
    expect(r.status).toBe('completed');
    expect(perTurn).toEqual([
      ['반복 1:running', '반복 2:expected'],
      ['반복 1:done', '반복 2:running', '반복 3:expected'],
    ]);
    expect(iterations(tree)).toEqual(['반복 1:done', '반복 2:done', '반복 3:skipped']);
    expect(getStage(tree, 'again.3').reason).toContain('반복을 마쳐서 건너뛰었어요');
    expect(statuses(tree)).toMatchObject({
      again: 'done',
      'again.1.fix': 'done',
      'again.2.fix': 'done',
      wrap: 'done',
    });
  });

  it('최대 회차를 넘지 않는다', async () => {
    const { tree } = await runWithStages({
      pipeline: LOOP(3),
      outputs: (_n, k) => ({ ok: false, step: k, summary: '고쳤어요.' }),
    });
    expect(iterations(tree)).toEqual(['반복 1:done', '반복 2:done', '반복 3:done']);
    expect(getStage(tree, 'again').status).toBe('done');
  });
});
