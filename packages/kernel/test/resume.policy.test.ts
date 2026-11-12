import { describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import { autoResumeDecision, type RunMode } from '../src/resume-policy.js';

const NOW = new Date('2026-11-12T12:00:00.000Z');

describe('2B.11 자동 재개 규칙 (mode 인자 순수 함수)', () => {
  it('① 사용량 한도 → 리셋 시각에 자동 (지났으면 바로, 모르면 카드)', () => {
    const resetAt = new Date('2026-11-12T15:00:00.000Z');
    expect(autoResumeDecision({ reason: 'quota' }, { mode: 'normal', now: NOW, resetAt })).toMatchObject({
      action: 'schedule',
      at: '2026-11-12T15:00:00.000Z',
    });
    expect(
      autoResumeDecision(
        { reason: 'quota' },
        { mode: 'normal', now: new Date('2026-11-12T15:00:00.000Z'), resetAt },
      ),
    ).toMatchObject({ action: 'resume' });
    expect(autoResumeDecision({ reason: 'quota' }, { mode: 'auto', now: NOW })).toMatchObject({
      action: 'card',
    });
  });

  it('② 오류 → 일반 모드는 카드, 오토 모드는 자동', () => {
    expect(autoResumeDecision({ reason: 'crash' }, { mode: 'normal', now: NOW }).action).toBe('card');
    expect(autoResumeDecision({ reason: 'crash' }, { mode: 'plan', now: NOW }).action).toBe('card');
    expect(autoResumeDecision({ reason: 'crash' }, { mode: 'auto', now: NOW }).action).toBe('resume');
  });

  it('③ 사용자 정지 → 어떤 모드에서도 사용자만', () => {
    for (const mode of ['plan', 'normal', 'auto'] as RunMode[])
      expect(autoResumeDecision({ reason: 'user' }, { mode, now: NOW }).action).toBe('wait-user');
    expect(autoResumeDecision({ reason: 'budget' }, { mode: 'auto', now: NOW }).action).toBe('wait-user');
  });

  it('④ 승인 대기 → 응답이 오면 자동', () => {
    expect(autoResumeDecision({ reason: 'approval' }, { mode: 'normal', now: NOW }).action).toBe(
      'wait-approval',
    );
    expect(
      autoResumeDecision({ reason: 'approval' }, { mode: 'normal', now: NOW, approvalAnswered: true }).action,
    ).toBe('resume');
  });

  it('이유 문구는 쉬운 말', () => {
    for (const reason of ['quota', 'crash', 'user', 'approval', 'budget'] as const)
      for (const mode of ['normal', 'auto'] as RunMode[]) {
        const d = autoResumeDecision({ reason }, { mode, now: NOW, resetAt: new Date('2026-11-13') });
        expect(checkPlainKorean(d.why).violations).toEqual([]);
      }
  });
});
