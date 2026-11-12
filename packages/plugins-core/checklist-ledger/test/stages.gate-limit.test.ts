import { describe, expect, it } from 'vitest';
import { MAX_GATE_FAILURES, applyGateFailure, getStage } from '../src/index.js';
import { atCritic, finding } from './stages-gate-fixture.js';

describe('4D.4 같은 검사 3회 실패 → blocked + 확인 카드 (오토 모드면 확인 목록)', () => {
  function failTimes(n: number, mode: 'normal' | 'auto') {
    let t = atCritic();
    let last;
    for (let k = 0; k < n; k++) {
      last = applyGateFailure(t, 'critic', [finding], { mode });
      t = last.tree;
    }
    return last!;
  }

  it('2회까지는 재작업, 3회째 blocked', () => {
    expect(failTimes(2, 'normal').blocked).toBeUndefined();
    const r = failTimes(MAX_GATE_FAILURES, 'normal');
    expect(getStage(r.tree, 'critic').status).toBe('blocked');
    expect(r.blocked?.card).toEqual({
      kind: 'stage_blocked',
      stageId: 'critic',
      title: 'critic 검사를 3번 통과하지 못했어요',
      body: '같은 문제가 계속 나와서 멈췄어요. 마지막 지적: 버튼 글자 대비가 낮아요',
      options: ['직접 고친 뒤 다시 하기', '이 검사 건너뛰기', '여기서 멈추기'],
    });
    expect(r.rework).toEqual([]);
  });

  it('오토 모드면 카드 대신 "돌아오면 확인할 것" 줄', () => {
    const r = failTimes(3, 'auto');
    expect(r.blocked?.card).toBeUndefined();
    expect(r.blocked?.review).toEqual({
      stageId: 'critic',
      text: 'critic 검사를 3번 통과하지 못했어요: 버튼 글자 대비가 낮아요',
    });
  });
});
