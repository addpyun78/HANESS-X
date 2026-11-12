// @features F-019
import { describe, expect, it } from 'vitest';
import { ITEM_STATUSES, type ItemStatus } from '../src/schema.js';
import {
  InvalidTransitionError,
  assertTransition,
  canTransition,
  isTerminal,
  transitionMatrix,
} from '../src/state.js';

const ALLOWED = new Set([
  'todo>doing',
  'doing>verifying',
  'verifying>done',
  'verifying>failed',
  'failed>doing',
  'todo>blocked',
  'doing>blocked',
  'verifying>blocked',
  'failed>blocked',
]);

const pairs: [ItemStatus, ItemStatus][] = ITEM_STATUSES.flatMap((f) =>
  ITEM_STATUSES.map((t) => [f, t] as [ItemStatus, ItemStatus]),
);

describe('20.2 상태 전이표', () => {
  it('6×6 = 36 조합 전부 검사', () => {
    expect(pairs).toHaveLength(36);
    expect(transitionMatrix()).toHaveLength(36);
    expect(transitionMatrix().filter((m) => m.allowed)).toHaveLength(ALLOWED.size);
  });

  it.each(pairs)('%s → %s', (from, to) => {
    const ok = ALLOWED.has(`${from}>${to}`);
    expect(canTransition(from, to)).toBe(ok);
    if (ok) expect(() => assertTransition('1', from, to)).not.toThrow();
    else expect(() => assertTransition('1', from, to)).toThrow(InvalidTransitionError);
  });

  it('done·blocked는 종단 상태', () => {
    expect(ITEM_STATUSES.filter(isTerminal)).toEqual(['done', 'blocked']);
  });
});
