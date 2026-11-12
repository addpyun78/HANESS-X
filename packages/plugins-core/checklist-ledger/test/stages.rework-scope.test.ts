// @features F-108
import { describe, expect, it } from 'vitest';
import { applyGateFailure, getStage } from '../src/index.js';
import { atCritic, finding } from './stages-gate-fixture.js';

describe('4D.2 재작업 범위 최소화', () => {
  it('지적과 관련된 재작업 항목만 할 일, 나머지 항목은 done 유지', () => {
    const r = applyGateFailure(atCritic(), 'critic', [finding]);
    const b = getStage(r.tree, 'build');
    expect(b.items.map((i) => [i.id, i.status])).toEqual([
      ['build1', 'done'],
      ['build2', 'done'],
      ['build-r1', 'todo'],
    ]);
    expect(getStage(r.tree, 'plan').status).toBe('done');
    expect(getStage(r.tree, 'plan').items.every((i) => i.status === 'done')).toBe(true);
  });
});
