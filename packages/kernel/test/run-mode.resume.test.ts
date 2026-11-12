import { describe, expect, it } from 'vitest';
import { resumeRunMode } from '../src/run-mode/resume.js';

// T-101 3E.6 이어하기(2번) 시 모드 유지, 이어하기 카드에서 변경 가능 — 재개 테스트

describe('3E.6 재개 모드', () => {
  it('멈추기 전 모드를 그대로 쓴다 (기본값이 달라도)', () => {
    expect(
      resumeRunMode({ session: { mode: 'auto' }, defaults: { global: 'plan', agent: 'normal' } }),
    ).toEqual({
      mode: 'auto',
      from: 'session',
      changed: false,
    });
  });

  it('이어하기 카드에서 바꾸면 그 값, 바뀐 것을 표시', () => {
    expect(resumeRunMode({ session: { mode: 'auto' }, choice: 'normal' })).toEqual({
      mode: 'normal',
      from: 'card',
      changed: true,
    });
    expect(resumeRunMode({ session: { mode: 'auto' }, choice: 'auto' }).changed).toBe(false);
  });

  it('옛 세션(모드 기록 없음)은 지금 기본값 순서(에이전트 > 프로젝트 > 전체)', () => {
    expect(resumeRunMode({ session: {}, defaults: { project: 'plan', global: 'auto' } })).toEqual({
      mode: 'plan',
      from: 'project',
      changed: false,
    });
    expect(resumeRunMode({ session: { mode: 'weird' } })).toEqual({
      mode: 'normal',
      from: 'fallback',
      changed: false,
    });
  });

  it('카드에서 모르는 값을 보내면 무시하고 유지', () => {
    expect(resumeRunMode({ session: { mode: 'plan' }, choice: 'turbo' }).mode).toBe('plan');
  });
});
