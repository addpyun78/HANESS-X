import { describe, expect, it } from 'vitest';
import {
  advanceStage,
  applyGateFailure,
  completeStage,
  getStage,
  markItemsDone,
  renderStageTreeMarkdown,
} from '../src/index.js';
import { atCritic, finding } from './stages-gate-fixture.js';
import { FIXED_NOW } from './stages-helpers.js';

describe('4D.1 검사 실패 → 지적 대상 단계에 재작업 항목(r1, r2) + reopened', () => {
  it('리플레이: critic이 build를 두 번 지적', () => {
    const r1 = applyGateFailure(atCritic(), 'critic', [finding], { now: FIXED_NOW });
    const b = getStage(r1.tree, 'build');
    expect(b.status).toBe('reopened');
    expect(r1.rework).toEqual([{ stageId: 'build', itemId: 'build-r1' }]);
    expect(b.itemMeta['build-r1']).toEqual({
      origin: 'rework',
      rework: 1,
      gateStageId: 'critic',
      note: '버튼 글자 대비가 낮아요',
      reworkOf: 'build2',
      link: 'event:ev-42',
    });
    // 다시 고친 뒤 또 지적
    let t = advanceStage(r1.tree, 'build', 'running');
    t = markItemsDone(t, 'build');
    t = completeStage(t, 'build', { handoff: { output: {}, summary: '고쳤어요' } }).tree;
    const r2 = applyGateFailure(t, 'critic', [{ ...finding, reason: '아직 낮아요' }]);
    expect(r2.rework).toEqual([{ stageId: 'build', itemId: 'build-r2' }]);
    expect(renderStageTreeMarkdown(r2.tree)).toMatchSnapshot();
  });
});
