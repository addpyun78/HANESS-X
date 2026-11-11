import type { NotifierLike } from '../panels/Approvals/useApprovals.js';

/**
 * T-101 3D.9 오토 실행 중 알림 최소화: 토스트 없음, 배지만 (끝날 때 요약 카드 + OS 알림 1번 — 3D.8).
 * 정지 버튼은 모드와 상관없이 실행 중이면 항상 누를 수 있다.
 */

export interface NotifyPolicy {
  /** 화면 구석 토스트 */
  toasts: boolean;
  /** 카드마다 OS 알림 */
  osPerCard: boolean;
  /** 사이드바·탭 배지 (항상) */
  badge: true;
}

export function notifyPolicy(autoRunning: boolean): NotifyPolicy {
  return autoRunning
    ? { toasts: false, osPerCard: false, badge: true }
    : { toasts: true, osPerCard: true, badge: true };
}

/** 지금 오토로 실행 중인 세션이 있나 */
export function isAutoRunning(sessions: readonly { mode?: string; status: string }[]): boolean {
  return sessions.some((s) => s.mode === 'auto' && s.status === 'running');
}

/** 정책에 맞춰 토스트 거르기 */
export function quietToasts<T>(toasts: readonly T[], policy: NotifyPolicy): readonly T[] {
  return policy.toasts ? toasts : [];
}

/** 카드마다 OS 알림을 막는 알림기 (승인 영역 useApprovals의 notifier 자리) */
export const SILENT_NOTIFIER: NotifierLike = Object.freeze({
  permission: 'denied' as NotificationPermission,
  requestPermission: () => Promise.resolve('denied' as NotificationPermission),
  show: () => {},
});

/** 정지 버튼: 실행 중이면 모드와 상관없이 항상 켜짐 */
export function stopEnabled(running: boolean): boolean {
  return running;
}
