import type { PausedInfo } from './stop.js';

/**
 * T-101 2B.11 자동 재개 규칙 (순수 함수 — 실행 모드는 3번이 나중에 mode 인자로 연결)
 *  - 사용량 한도(quota) → 리셋 시각에 자동
 *  - 오류(crash)        → 일반 모드는 카드, 오토 모드는 자동
 *  - 사용자 정지(user)  → 사용자만 (자동 재개 없음)
 *  - 승인 대기(approval) → 응답이 오면 자동
 *  - 예산(budget)       → 사용자만 (표에 없음: 돈이 드는 일은 사람이 정한다)
 */

/** 3번 실행 모드 (계획 / 일반 / 오토) */
export type RunMode = 'plan' | 'normal' | 'auto';

export type AutoResumeDecision =
  /** 지금 자동으로 이어한다 */
  | { action: 'resume'; why: string }
  /** 이 시각에 자동으로 이어한다 */
  | { action: 'schedule'; at: string; why: string }
  /** "이어서 할 작업" 카드로 사용자에게 묻는다 */
  | { action: 'card'; why: string }
  /** 사용자가 [이어하기]를 누를 때까지 기다린다 */
  | { action: 'wait-user'; why: string }
  /** 승인 카드 응답을 기다린다 (응답이 오면 자동) */
  | { action: 'wait-approval'; why: string };

export interface AutoResumeContext {
  mode: RunMode;
  now: Date;
  /** quota: 사용량 리셋 시각 (quota.ts routeQuotaExceeded의 until) */
  resetAt?: Date;
  /** approval: 승인 카드에 응답이 왔나 */
  approvalAnswered?: boolean;
}

export function autoResumeDecision(
  paused: Pick<PausedInfo, 'reason'>,
  ctx: AutoResumeContext,
): AutoResumeDecision {
  switch (paused.reason) {
    case 'quota':
      if (!ctx.resetAt) return { action: 'card', why: '사용량이 언제 다시 차는지 몰라요.' };
      return ctx.resetAt.getTime() <= ctx.now.getTime()
        ? { action: 'resume', why: '사용량이 다시 찼어요.' }
        : { action: 'schedule', at: ctx.resetAt.toISOString(), why: '사용량이 다시 차는 때에 이어서 해요.' };
    case 'crash':
      return ctx.mode === 'auto'
        ? { action: 'resume', why: '오토 모드라서 오류 뒤에 바로 이어서 해요.' }
        : { action: 'card', why: '오류로 멈췄어요. 이어할지 물어볼게요.' };
    case 'approval':
      return ctx.approvalAnswered
        ? { action: 'resume', why: '확인 카드에 대답해서 이어서 해요.' }
        : { action: 'wait-approval', why: '확인 카드에 대답하면 이어서 해요.' };
    case 'user':
      return { action: 'wait-user', why: '직접 멈춘 작업은 직접 이어할 때만 다시 시작해요.' };
    case 'budget':
      return { action: 'wait-user', why: '예산을 다 써서 멈췄어요. 직접 정해 주세요.' };
  }
}
