import { describe, expect, it } from 'vitest';
import {
  LOCK_REASONS,
  buildSkeleton,
  decideLock,
  enterStage,
  getStage,
  lockStage,
  type RunMode,
} from '../src/index.js';
import { THREE, templates } from './stages-helpers.js';

describe('4B.3 단계 확정 규칙 (모드는 인자)', () => {
  const cases: [RunMode, boolean, boolean, boolean, string][] = [
    // mode, first, lintOk, inScope → action
    ['normal', true, true, true, 'approve'],
    ['normal', false, true, true, 'auto'],
    ['normal', false, false, true, 'approve'],
    ['normal', false, true, false, 'approve'],
    ['plan', true, true, true, 'stop'],
    ['plan', false, true, true, 'stop'],
    ['auto', true, true, true, 'auto'],
    ['auto', false, false, false, 'auto'],
  ];
  it.each(cases)('%s first=%s lint=%s scope=%s → %s', (mode, first, lintOk, inScope, action) => {
    expect(decideLock({ mode, first, lintOk, inScope }).action).toBe(action);
  });

  it('승인 이유는 쉬운 말', () => {
    expect(decideLock({ mode: 'normal', first: true, lintOk: true, inScope: true })).toEqual({
      action: 'approve',
      reason: LOCK_REASONS.first,
    });
    expect(decideLock({ mode: 'plan', first: true, lintOk: true, inScope: true })).toMatchObject({
      reason: LOCK_REASONS.plan,
    });
  });

  it('확정하면 planning → locked', async () => {
    const t = buildSkeleton({ sessionId: 's', agent: { name: 'three', pipeline: THREE }, templates });
    const r = await enterStage(t, 'plan');
    expect(getStage(lockStage(r.tree, 'plan'), 'plan').status).toBe('locked');
  });
});
