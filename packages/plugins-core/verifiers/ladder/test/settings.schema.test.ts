import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  JudgeSettingsSchema,
  LegacyVerifierConfigError,
  judgeSettingsFrom,
  legacyVerifierKeys,
  type JudgeSettings,
} from '../src/settings.js';

describe('J.4 설정 스키마: verifier.l4 폐기, judge.*로 통합', () => {
  it('judge 기본값: engine "" (자동), semantic on', () => {
    expect(judgeSettingsFrom({})).toEqual({ engine: '', semantic: 'on' });
    expectTypeOf<JudgeSettings['semantic']>().toEqualTypeOf<'on' | 'off'>();
    expectTypeOf<JudgeSettings['engine']>().toEqualTypeOf<string>();
  });

  it('중첩·평면 judge.* 키를 읽고, E.1의 나머지 키는 그대로 통과', () => {
    expect(judgeSettingsFrom({ judge: { engine: 'codex', samples: 3 } })).toEqual({
      engine: 'codex',
      semantic: 'on',
      samples: 3,
    });
    expect(judgeSettingsFrom({ 'judge.semantic': 'off', 'judge.local.model': 'qwen3' })).toMatchObject({
      semantic: 'off',
      'local.model': 'qwen3',
    });
    expect(JudgeSettingsSchema.safeParse({ semantic: 'maybe' }).success).toBe(false);
    expect(JudgeSettingsSchema.safeParse({ engine: 3 }).success).toBe(false);
  });

  it('verifier.l4(중첩·평면)와 삭제된 서비스 절은 거부, verifier.local(로컬 판정기 설정)은 허용', () => {
    for (const cfg of [
      { verifier: { l4: 'off' } },
      { 'verifier.l4': 'local' },
      { verifier: { remote: { endpoint: 'x' } } },
    ])
      expect(() => judgeSettingsFrom(cfg)).toThrow(LegacyVerifierConfigError);
    expect(() => judgeSettingsFrom({ verifier: { l4: 'off' } })).toThrow(/verifier\.l4.+폐기/);
    expect(legacyVerifierKeys({ verifier: { local: { model: 'q' } } })).toEqual([]);
    expect(judgeSettingsFrom({ verifier: { local: { model: 'q' } } })).toEqual({
      engine: '',
      semantic: 'on',
    });
  });
});
