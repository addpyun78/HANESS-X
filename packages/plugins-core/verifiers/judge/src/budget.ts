import { JUDGE_DEFAULT_MAX_CALLS_PER_SESSION } from './settings.js';

/**
 * E.13 세션별 판정 호출 상한 (judge.maxCallsPerSession, 기본 50).
 * 상한을 넘으면 의미 판단을 생략하고 승인 카드로 보낸다(unavailable, reason 'limit').
 */
export class SessionCallBudget {
  private readonly used = new Map<string, number>();
  constructor(readonly maxCallsPerSession = JUDGE_DEFAULT_MAX_CALLS_PER_SESSION) {}

  usedBy(sessionId: string): number {
    return this.used.get(sessionId) ?? 0;
  }

  remaining(sessionId: string): number {
    return Math.max(0, this.maxCallsPerSession - this.usedBy(sessionId));
  }

  /** n회를 예약할 수 있으면 차감하고 true, 아니면 아무것도 바꾸지 않고 false */
  tryReserve(sessionId: string, n: number): boolean {
    if (n > this.remaining(sessionId)) return false;
    this.used.set(sessionId, this.usedBy(sessionId) + n);
    return true;
  }

  reset(sessionId?: string): void {
    if (sessionId === undefined) this.used.clear();
    else this.used.delete(sessionId);
  }
}
