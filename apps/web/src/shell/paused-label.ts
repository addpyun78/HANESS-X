/**
 * T-101 2A.9 멈춘 세션의 이유 (kernel stop.ts PAUSE_REASON_LABEL과 같은 말)
 * 사이드바 상태: "멈춤 (사용자가 멈춤)"
 */
export type PausedReason = 'user' | 'quota' | 'crash' | 'approval' | 'budget';

export const PAUSED_REASON_LABEL: Record<PausedReason, string> = {
  user: '사용자가 멈춤',
  quota: '사용량 한도에 닿음',
  crash: '오류로 멈춤',
  approval: '승인을 기다림',
  budget: '예산을 다 씀',
};

export function isPausedReason(v: unknown): v is PausedReason {
  return typeof v === 'string' && v in PAUSED_REASON_LABEL;
}

/** "멈춤 (사용자가 멈춤)" — 이유를 모르면 "멈춤" */
export function pausedLabel(reason: string | undefined): string {
  return isPausedReason(reason) ? `멈춤 (${PAUSED_REASON_LABEL[reason]})` : '멈춤';
}
