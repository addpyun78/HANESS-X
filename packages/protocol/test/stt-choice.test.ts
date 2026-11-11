import { describe, expect, it } from 'vitest';
import { chooseSttProvider, SttSettingsSchema } from '../src/index.js';

describe('P4-B.7 STT 선택 규칙 (stt.provider = local | browser | off)', () => {
  it('경로 1 — 기본: local 감지 시 local', () => {
    expect(chooseSttProvider({}, { local: true, browser: true })).toEqual({ provider: 'local' });
  });

  it('경로 2 — 기본: local 없으면 browser (동의 필요)', () => {
    expect(chooseSttProvider({}, { local: false, browser: true })).toEqual({
      provider: 'browser',
      needsConsent: true,
    });
  });

  it('경로 3 — 설정 off면 아무것도 쓰지 않음', () => {
    expect(chooseSttProvider({ provider: 'off' }, { local: true, browser: true })).toEqual({
      provider: 'off',
      reason: 'setting',
    });
  });

  it('설정이 우선: browser 지정이면 local이 있어도 browser, 지정한 것이 없으면 off', () => {
    expect(chooseSttProvider({ provider: 'browser' }, { local: true, browser: true })).toMatchObject({
      provider: 'browser',
    });
    expect(chooseSttProvider({ provider: 'local' }, { local: false, browser: true })).toEqual({
      provider: 'off',
      reason: 'unavailable',
    });
    expect(chooseSttProvider({}, { local: false, browser: false })).toEqual({
      provider: 'off',
      reason: 'unavailable',
    });
  });

  it('설정 스키마: local | browser | off 만 허용', () => {
    expect(SttSettingsSchema.parse({ provider: 'local' })).toEqual({ provider: 'local' });
    expect(SttSettingsSchema.parse({})).toEqual({});
    expect(SttSettingsSchema.safeParse({ provider: 'cloud' }).success).toBe(false);
  });
});
