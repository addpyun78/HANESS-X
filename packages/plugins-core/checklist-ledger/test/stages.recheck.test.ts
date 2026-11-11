import { describe, expect, it } from 'vitest';
import { applyGateFailure, getStage, recheckStage } from '../src/index.js';
import { atCritic, finding } from './stages-gate-fixture.js';

describe('4D.3 뒤 단계 영향: needs-recheck → 다시 지날 때 출구 조건만 재검사', () => {
  it('reopened 이후 done 단계는 needs-recheck, 통과하면 그대로 done', () => {
    const r = applyGateFailure(atCritic(), 'critic', [finding]);
    expect(r.recheck).toEqual(['doc']);
    expect(getStage(r.tree, 'doc').status).toBe('needs-recheck');
    // 하위 항목은 다시 하지 않는다
    expect(getStage(r.tree, 'doc').items.every((i) => i.status === 'done')).toBe(true);
    const ok = recheckStage(r.tree, 'doc');
    expect(ok.done).toBe(true);
    expect(getStage(ok.tree, 'doc').status).toBe('done');
  });

  it('재검사에서 출구 조건 실패면 reopened', () => {
    const r = applyGateFailure(atCritic(), 'critic', [finding]);
    const t = structuredClone(r.tree);
    getStage(t, 'doc').handoff!.output = { nothing: true };
    const bad = recheckStage(t, 'doc');
    expect(bad.done).toBe(false);
    expect(getStage(bad.tree, 'doc').status).toBe('reopened');
  });
});
