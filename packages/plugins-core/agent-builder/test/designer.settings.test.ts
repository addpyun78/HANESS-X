import { describe, expect, it } from 'vitest';
import {
  BuilderSettingsSchema,
  DEFAULT_BUILDER_SETTINGS,
  parseBuilderSettings,
  resolveDesignerEngine,
} from '../src/designer/settings.js';

describe('P4-C.1 설정 builder.engine · builder.maxQuestions', () => {
  it('기본값: engine 빈 값(세션 기본), maxQuestions 3', () => {
    expect(DEFAULT_BUILDER_SETTINGS).toEqual({ engine: '', maxQuestions: 3, animation: true });
    expect(parseBuilderSettings({ builder: { engine: 'codex' } }).engine).toBe('codex');
  });
  it('잘못된 값 거부: maxQuestions 4 이상·음수·소수, 모르는 키', () => {
    for (const bad of [{ maxQuestions: 4 }, { maxQuestions: -1 }, { maxQuestions: 1.5 }, { foo: 1 }])
      expect(BuilderSettingsSchema.safeParse(bad).success).toBe(false);
  });
  it('엔진 고르기: 설정값이 감지된 엔진이면 그것, 비었거나 감지 안 됐으면 세션 기본', () => {
    const detected = ['claude', 'codex'];
    expect(resolveDesignerEngine({ engine: 'codex' }, detected, 'claude-code')).toEqual({
      engineId: 'codex',
      from: 'setting',
    });
    expect(resolveDesignerEngine({ engine: '' }, detected, 'claude')).toEqual({
      engineId: 'claude-code',
      from: 'session-default',
    });
    expect(resolveDesignerEngine({ engine: 'gemini' }, detected, 'codex').from).toBe('session-default');
    expect(resolveDesignerEngine({ engine: '' }, [], undefined)).toEqual({
      engineId: undefined,
      from: 'none',
    });
  });
});
