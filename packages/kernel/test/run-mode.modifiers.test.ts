import { describe, expect, it } from 'vitest';
import { parseModifiers } from '../src/dispatch.js';

// T-101 3E.1 / 수식어 !plan, !auto (이번 실행만) — 파서 테스트

describe('3E.1 모드 수식어 파서', () => {
  it('!auto → 이번 실행만 오토, 지시문에서 빠진다', () => {
    const r = parseModifiers('/design-qa !auto 화면 검수해 줘');
    expect(r.modifiers.mode).toBe('auto');
    expect(r.modifiers.planOnly).toBe(false);
    expect(r.prompt).toBe('/design-qa 화면 검수해 줘');
    expect(r.tokens).toEqual(['!auto']);
  });

  it('!plan → 계획 모드 (기존 planOnly도 유지)', () => {
    const r = parseModifiers('!plan 결제 흐름');
    expect(r.modifiers).toMatchObject({ mode: 'plan', planOnly: true });
    expect(r.prompt).toBe('결제 흐름');
  });

  it('대소문자 무시, 다른 수식어와 같이', () => {
    const r = parseModifiers('@codex !AUTO #strict 고쳐');
    expect(r.modifiers).toEqual({ engine: 'codex', strict: true, planOnly: false, mode: 'auto' });
    expect(r.prompt).toBe('고쳐');
  });

  it('둘 다 쓰면 나중 것', () => {
    expect(parseModifiers('!plan !auto x').modifiers.mode).toBe('auto');
    expect(parseModifiers('!auto !plan x').modifiers.mode).toBe('plan');
  });

  it('수식어가 없으면 mode 없음, 낱말 중간·비슷한 낱말은 수식어 아님', () => {
    expect(parseModifiers('그냥 해').modifiers.mode).toBeUndefined();
    const r = parseModifiers('멋져!auto !autopilot auto');
    expect(r.modifiers.mode).toBeUndefined();
    expect(r.prompt).toBe('멋져!auto !autopilot auto');
  });
});
