import { describe, expect, it } from 'vitest';
import { ModeController, modeApplyAt, type ModeChangeRecord } from '../src/run-mode/transition.js';

// T-101 3E.4 실행 중 모드 변경: 계획→일반은 계획 승인으로, 일반↔오토는 다음 턴부터, 기록

function ctl(initial: 'plan' | 'normal' | 'auto') {
  const recs: ModeChangeRecord[] = [];
  const c = new ModeController({
    sessionId: 's1',
    initial,
    record: (r) => recs.push(r),
    now: () => new Date('2026-11-12T00:00:00.000Z'),
  });
  return { c, recs };
}

describe('3E.4 전환', () => {
  it('언제 적용되나 (순수)', () => {
    expect(modeApplyAt('plan', 'normal', true)).toBe('on-plan-approval');
    expect(modeApplyAt('plan', 'auto', true)).toBe('on-plan-approval');
    expect(modeApplyAt('normal', 'auto', true)).toBe('next-turn');
    expect(modeApplyAt('auto', 'normal', true)).toBe('next-turn');
    expect(modeApplyAt('normal', 'auto', false)).toBe('now');
  });

  it('일반 → 오토: 지금 턴은 일반, 다음 턴부터 오토, 요청·적용 두 번 기록', () => {
    const { c, recs } = ctl('normal');
    c.setRunning(true);
    expect(c.request('auto')).toBe('next-turn');
    expect(c.mode).toBe('normal');
    expect(c.pendingMode).toBe('auto');
    c.onTurnStart();
    expect(c.mode).toBe('auto');
    expect(c.pendingMode).toBeUndefined();
    expect(recs.map((r) => [r.phase, r.from, r.to, r.apply])).toEqual([
      ['requested', 'normal', 'auto', 'next-turn'],
      ['applied', 'normal', 'auto', 'next-turn'],
    ]);
  });

  it('오토 → 일반도 다음 턴부터', () => {
    const { c } = ctl('auto');
    c.setRunning(true);
    c.request('normal');
    expect(c.mode).toBe('auto');
    c.onTurnStart();
    expect(c.mode).toBe('normal');
  });

  it('계획 → 일반: 턴이 바뀌어도 그대로, 계획 승인 때 바뀐다', () => {
    const { c, recs } = ctl('plan');
    c.setRunning(true);
    expect(c.request('normal')).toBe('on-plan-approval');
    c.onTurnStart();
    expect(c.mode).toBe('plan');
    c.onPlanApproved();
    expect(c.mode).toBe('normal');
    expect(recs.at(-1)).toMatchObject({
      phase: 'applied',
      from: 'plan',
      to: 'normal',
      apply: 'on-plan-approval',
    });
  });

  it('계획 완료 카드에서 [오토로 실행] → 계획 승인과 함께 오토', () => {
    const { c, recs } = ctl('plan');
    c.setRunning(true);
    c.onPlanApproved('auto');
    expect(c.mode).toBe('auto');
    expect(recs.at(-1)).toMatchObject({
      by: 'plan-card',
      to: 'auto',
      sessionId: 's1',
      at: '2026-11-12T00:00:00.000Z',
    });
  });

  it('실행 중이 아니면 바로, 같은 모드면 기록 없음', () => {
    const { c, recs } = ctl('normal');
    expect(c.request('auto')).toBe('now');
    expect(c.mode).toBe('auto');
    c.request('auto');
    expect(recs).toHaveLength(2);
  });
});
