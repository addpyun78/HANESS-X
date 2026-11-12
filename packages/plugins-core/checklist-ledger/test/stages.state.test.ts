import { describe, expect, it } from 'vitest';
import {
  STAGE_STATUSES,
  InvalidStageTransitionError,
  assertStageTransition,
  canStageTransition,
  isStageSettled,
  stageTransitionMatrix,
  type StageStatus,
} from '../src/index.js';

/** 전이표 원본 (설계: expected → planning → locked → running → verifying → done + reopened/needs-recheck/skipped/blocked) */
const ALLOWED: Record<StageStatus, StageStatus[]> = {
  expected: ['planning', 'skipped', 'blocked'],
  planning: ['locked', 'blocked'],
  locked: ['running', 'blocked'],
  running: ['verifying', 'blocked'],
  verifying: ['done', 'running', 'reopened', 'blocked'],
  done: ['reopened', 'needs-recheck'],
  reopened: ['running', 'blocked'],
  'needs-recheck': ['verifying', 'reopened', 'blocked'],
  skipped: [],
  blocked: ['reopened'],
};

describe('4A.3 단계 상태 전이표', () => {
  it('상태 10종', () => {
    expect([...STAGE_STATUSES]).toEqual([
      'expected',
      'planning',
      'locked',
      'running',
      'verifying',
      'done',
      'reopened',
      'needs-recheck',
      'skipped',
      'blocked',
    ]);
  });

  it('전 조합 100개: 허용 여부가 표와 같다', () => {
    const m = stageTransitionMatrix();
    expect(m).toHaveLength(100);
    for (const { from, to, allowed } of m) {
      expect(allowed, `${from} → ${to}`).toBe(ALLOWED[from].includes(to));
      expect(canStageTransition(from, to)).toBe(allowed);
      if (allowed) expect(() => assertStageTransition('s', from, to)).not.toThrow();
      else expect(() => assertStageTransition('s', from, to)).toThrow(InvalidStageTransitionError);
    }
  });

  it('기본 흐름: expected → planning → locked → running → verifying → done', () => {
    const path: StageStatus[] = ['expected', 'planning', 'locked', 'running', 'verifying', 'done'];
    for (let k = 0; k < path.length - 1; k++) expect(canStageTransition(path[k]!, path[k + 1]!)).toBe(true);
  });

  it('done·skipped만 끝난 상태로 본다', () => {
    expect(STAGE_STATUSES.filter(isStageSettled)).toEqual(['done', 'skipped']);
  });
});
