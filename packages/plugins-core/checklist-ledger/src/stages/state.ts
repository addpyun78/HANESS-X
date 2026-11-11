import { STAGE_STATUSES, type StageStatus } from './schema.js';

/**
 * 단계 상태 전이표 (T-101 4A.3)
 *   expected(예상) → planning → locked → running → verifying → done
 *   verifying → running            (출구 조건 실패 → 다시 진행)
 *   verifying → reopened           (다시 확인에서 출구 조건 실패)
 *   done → reopened                (검사 단계가 이 단계를 지적 — 재작업 항목 추가)
 *   done → needs-recheck           (앞 단계가 다시 열림 — 다시 지날 때 출구 조건만 재검사)
 *   needs-recheck → verifying | reopened
 *   reopened → running
 *   expected → skipped             (분기에서 안 고른 길, 반복에서 남은 회차)
 *   (done·skipped 밖의 상태) → blocked,  blocked → reopened (사람이 확인한 뒤)
 * skipped는 종단 상태다.
 */
export const STAGE_TRANSITIONS: Readonly<Record<StageStatus, readonly StageStatus[]>> = Object.freeze({
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
});

export class InvalidStageTransitionError extends Error {
  readonly code = 'INVALID_STAGE_TRANSITION';
  constructor(
    readonly stageId: string,
    readonly from: StageStatus,
    readonly to: StageStatus,
  ) {
    super(
      `단계 ${stageId}: ${from} → ${to} 전이는 허용되지 않습니다 (허용: ${STAGE_TRANSITIONS[from].join(', ') || '없음'})`,
    );
    this.name = 'InvalidStageTransitionError';
  }
}

export function canStageTransition(from: StageStatus, to: StageStatus): boolean {
  return STAGE_TRANSITIONS[from].includes(to);
}

export function assertStageTransition(stageId: string, from: StageStatus, to: StageStatus): void {
  if (!canStageTransition(from, to)) throw new InvalidStageTransitionError(stageId, from, to);
}

/** 세션 종료를 막지 않는 상태 (4A.6) */
export function isStageSettled(s: StageStatus): boolean {
  return s === 'done' || s === 'skipped';
}

/** 진행 중으로 보는 상태 (현재 단계 후보) */
export const ACTIVE_STAGE_STATUSES: readonly StageStatus[] = [
  'planning',
  'locked',
  'running',
  'verifying',
  'reopened',
  'needs-recheck',
];

export function stageTransitionMatrix(): { from: StageStatus; to: StageStatus; allowed: boolean }[] {
  return STAGE_STATUSES.flatMap((from) =>
    STAGE_STATUSES.map((to) => ({ from, to, allowed: canStageTransition(from, to) })),
  );
}
