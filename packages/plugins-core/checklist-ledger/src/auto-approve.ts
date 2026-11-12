import {
  lintChecklist,
  redecomposeMessage,
  type LintItem,
  type LintOptions,
  type LintViolation,
} from './lint.js';

/**
 * T-101 3D.1 오토 모드의 계획 자동 승인.
 * 원자성 린터를 통과해야만 확정(Lock)한다. 실패하면 위반 내용을 엔진에 돌려줘 다시 쪼개게 하고(최대 3회),
 * 그래도 실패하면 일시정지 + 알림 (사람이 돌아와 확인). 린터를 건너뛰는 길은 없다.
 */

export const AUTO_REDECOMPOSE_MAX = 3;

/** 3D.1 실패 알림 (쉬운 말) */
export const AUTO_PLAN_PAUSED_MESSAGE = '할 일 목록을 작게 나누지 못해서 멈췄어요. 목록을 확인해 주세요.';

export interface AutoApproveOptions<T extends LintItem = LintItem> {
  /** 첫 계획 */
  items: readonly T[];
  /** 위반 내용(재분해 요청 글)을 엔진에 보내고 새 계획을 받는다 */
  redecompose: (feedback: string, attempt: number) => Promise<readonly T[]> | readonly T[];
  /** 린터 통과 시 확정 */
  lock: (items: readonly T[]) => Promise<void> | void;
  /** 끝내 실패 → 일시정지 (2번 정지) */
  pause: (reason: 'plan_lint') => Promise<void> | void;
  /** 알림 (확인 목록·OS 알림) */
  notify: (message: string, violations: readonly LintViolation[]) => void;
  maxRedecompose?: number;
  lint?: LintOptions;
}

export type AutoApproveResult<T> =
  | { status: 'locked'; items: readonly T[]; redecomposed: number }
  | { status: 'paused'; violations: LintViolation[]; redecomposed: number };

export async function autoApprovePlan<T extends LintItem>(
  opts: AutoApproveOptions<T>,
): Promise<AutoApproveResult<T>> {
  const max = opts.maxRedecompose ?? AUTO_REDECOMPOSE_MAX;
  let items = opts.items;
  let redecomposed = 0;
  for (;;) {
    const r = lintChecklist(items, opts.lint);
    if (r.ok) {
      await opts.lock(items);
      return { status: 'locked', items, redecomposed };
    }
    if (redecomposed >= max) {
      await opts.pause('plan_lint');
      opts.notify(AUTO_PLAN_PAUSED_MESSAGE, r.violations);
      return { status: 'paused', violations: r.violations, redecomposed };
    }
    redecomposed++;
    items = await opts.redecompose(redecomposeMessage(r.violations), redecomposed);
  }
}
