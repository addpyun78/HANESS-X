import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JUDGE_SETTINGS,
  JudgeSettingsSchema,
  parseJudgeSettings,
  type JudgeSettings,
} from '@harness-x/judge';

describe('E.1 judge.* 설정 스키마', () => {
  it('기본값: engine=자동, samples=3, maxCallsPerSession=50, semantic=on, local.timeoutMs=20000', () => {
    expect(DEFAULT_JUDGE_SETTINGS).toEqual({
      engine: '',
      model: '',
      samples: 3,
      maxCallsPerSession: 50,
      semantic: 'on',
      local: { model: '', timeoutMs: 20000 },
    } satisfies JudgeSettings);
  });

  it('값 지정 + { judge: {...} } 감싸기 허용', () => {
    const s = parseJudgeSettings({
      judge: { engine: 'codex', model: 'gpt-5', samples: 1, semantic: 'off', local: { model: 'qwen3:8b' } },
    });
    expect(s.engine).toBe('codex');
    expect(s.model).toBe('gpt-5');
    expect(s.samples).toBe(1);
    expect(s.semantic).toBe('off');
    expect(s.local).toEqual({ model: 'qwen3:8b', timeoutMs: 20000 });
  });

  it('samples는 1~3 정수만', () => {
    for (const bad of [0, 4, 2.5, -1])
      expect(JudgeSettingsSchema.safeParse({ samples: bad }).success).toBe(false);
    for (const ok of [1, 2, 3]) expect(JudgeSettingsSchema.safeParse({ samples: ok }).success).toBe(true);
  });

  it('semantic은 on|off만, 음수 상한·모르는 키 거부', () => {
    expect(JudgeSettingsSchema.safeParse({ semantic: 'yes' }).success).toBe(false);
    expect(JudgeSettingsSchema.safeParse({ maxCallsPerSession: -1 }).success).toBe(false);
    expect(JudgeSettingsSchema.safeParse({ jev: { apiKey: 'x' } }).success).toBe(false);
    expect(JudgeSettingsSchema.safeParse({ local: { timeoutMs: 10 } }).success).toBe(false);
  });
});
