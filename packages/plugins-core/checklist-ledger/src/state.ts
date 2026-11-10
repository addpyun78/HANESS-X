import { ITEM_STATUSES, type ItemStatus } from './schema.js';

/**
 * 상태 전이표 (20.2)
 *   todo → doing → verifying → done
 *   verifying → failed → doing
 *   (done·blocked를 제외한 모든 상태) → blocked
 * 그 밖의 전이는 모두 거부한다. done과 blocked는 종단 상태다.
 */
export const TRANSITIONS: Readonly<Record<ItemStatus, readonly ItemStatus[]>> = Object.freeze({
  todo: ['doing', 'blocked'],
  doing: ['verifying', 'blocked'],
  verifying: ['done', 'failed', 'blocked'],
  failed: ['doing', 'blocked'],
  done: [],
  blocked: [],
});

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  constructor(
    readonly itemId: string,
    readonly from: ItemStatus,
    readonly to: ItemStatus,
  ) {
    super(
      `항목 ${itemId}: ${from} → ${to} 전이는 허용되지 않습니다 (허용: ${TRANSITIONS[from].join(', ') || '없음'})`,
    );
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(itemId: string, from: ItemStatus, to: ItemStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(itemId, from, to);
}

/** 종단 상태(더 이상 전이 불가) */
export function isTerminal(s: ItemStatus): boolean {
  return TRANSITIONS[s].length === 0;
}

/** 모든 (from, to) 조합과 허용 여부 — 문서·테스트용 */
export function transitionMatrix(): { from: ItemStatus; to: ItemStatus; allowed: boolean }[] {
  return ITEM_STATUSES.flatMap((from) =>
    ITEM_STATUSES.map((to) => ({ from, to, allowed: canTransition(from, to) })),
  );
}
