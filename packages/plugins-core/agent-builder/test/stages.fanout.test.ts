import {
  StageNotReadyError,
  buildSkeleton,
  canStartStage,
  enterStage,
  getStage,
} from '@harness-x/checklist-ledger';
import { describe, expect, it } from 'vitest';
import { FAN } from './stages-pipelines.js';
import { runWithStages, statuses } from './stages-run.js';

describe('4E.1 병렬(fanout): 갈래마다 단계, join은 모든 갈래가 끝난 뒤', () => {
  it('뼈대: 갈래마다 단계 + join이 두 갈래를 기다림', () => {
    const t = buildSkeleton({ sessionId: 's', agent: { name: 'fan', pipeline: FAN } });
    expect(t.stages.map((s) => [s.stageId, s.fanout ?? null, s.waitFor])).toEqual([
      ['web', 'split', []],
      ['mobile', 'split', []],
      ['merge', null, ['web', 'mobile']],
      ['ship', null, []],
    ]);
  });

  it('갈래가 남아 있으면 join을 시작할 수 없다', async () => {
    const t = buildSkeleton({ sessionId: 's', agent: { name: 'fan', pipeline: FAN } });
    expect(canStartStage(t, 'merge')).toEqual({ ok: false, waiting: ['web', 'mobile'] });
    await expect(enterStage(t, 'merge')).rejects.toBeInstanceOf(StageNotReadyError);
  });

  it('실행: 갈래가 진행되는 동안 join은 예상, 끝나면 모두 완료', async () => {
    const seen: Record<string, string>[] = [];
    const { r, tree } = await runWithStages({
      pipeline: FAN,
      onTurn: (_node, t) => seen.push(statuses(t)),
    });
    expect(r.status).toBe('completed');
    // web·mobile이 도는 동안 merge는 시작 전
    for (const s of seen.slice(0, 2)) expect(s.merge).toBe('expected');
    expect(statuses(tree)).toEqual({ web: 'done', mobile: 'done', merge: 'done', ship: 'done' });
    expect(getStage(tree, 'merge').waitFor).toEqual(['web', 'mobile']);
  });
});
