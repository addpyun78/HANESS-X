// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Toasts } from '../src/panels/Approvals/Toasts.js';
import type { Toast } from '../src/panels/Approvals/useApprovals.js';
import {
  isAutoRunning,
  notifyPolicy,
  quietToasts,
  SILENT_NOTIFIER,
  stopEnabled,
} from '../src/run-mode/notify-policy.js';

afterEach(cleanup);

const cards: Toast[] = Array.from({ length: 5 }, (_, i) => ({
  id: `t${i}`,
  cardId: `c${i}`,
  text: `확인할 일 ${i}`,
}));

// T-101 3D.9 오토 실행 중 알림 최소화(토스트 없음, 배지만), 정지 버튼은 항상 활성 — 알림 수 테스트
describe('3D.9 알림 수', () => {
  it('오토 실행 중: 카드 5장이 와도 토스트 0개, OS 알림 0번, 배지는 그대로', () => {
    const sessions = [
      { mode: 'auto', status: 'running' },
      { mode: 'normal', status: 'done' },
    ];
    expect(isAutoRunning(sessions)).toBe(true);
    const p = notifyPolicy(true);
    expect(p).toEqual({ toasts: false, osPerCard: false, badge: true });
    render(<Toasts toasts={quietToasts(cards, p)} onDismiss={() => {}} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // 승인 영역은 permission이 granted일 때만 OS 알림을 띄운다 → 조용한 알림기는 0번
    expect(SILENT_NOTIFIER.permission).not.toBe('granted');
  });

  it('일반 모드(또는 오토가 끝난 뒤): 토스트 5개', () => {
    expect(isAutoRunning([{ mode: 'auto', status: 'done' }, { status: 'running' }])).toBe(false);
    render(<Toasts toasts={quietToasts(cards, notifyPolicy(false))} onDismiss={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('정지 버튼은 실행 중이면 모드와 상관없이 켜짐', () => {
    expect(stopEnabled(true)).toBe(true);
    expect(stopEnabled(false)).toBe(false);
  });
});
