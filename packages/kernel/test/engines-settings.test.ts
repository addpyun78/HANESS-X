import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  EngineSettingSchema,
  EnginesSettingsSchema,
  loadEnginesSettings,
  parseEnginesSettings,
  type AuthMode,
} from '../src/engines-settings.js';
import { tempDir } from './helpers.js';

const EXAMPLE = fileURLToPath(new URL('../engines-settings.yaml', import.meta.url));

describe('13.2 엔진별 설정 스키마 {mode, model, fallback}', () => {
  it('예시 engines-settings.yaml 이 스키마를 통과한다', () => {
    const s = parseEnginesSettings(readFileSync(EXAMPLE, 'utf8'));
    expect(s.engines['claude-code']).toEqual({
      mode: 'subscription',
      model: 'claude-sonnet-4-5',
      fallback: ['codex'],
    });
    expect(s.engines.codex?.fallback).toEqual(['claude-code', 'openai-compat']);
    expect(s.engines.antigravity).toEqual({ mode: 'apiKey', fallback: [] });
  });

  it('mode는 subscription|apiKey 만', () => {
    expectTypeOf<AuthMode>().toEqualTypeOf<'subscription' | 'apiKey'>();
    expect(EngineSettingSchema.safeParse({ mode: 'oauth' }).success).toBe(false);
    expect(EngineSettingSchema.safeParse({}).success).toBe(false);
  });

  it('키 원문 등 알 수 없는 필드 거부', () => {
    expect(
      EngineSettingSchema.safeParse({ mode: 'apiKey', apiKey: 'sk-ant-xxxxxxxxxxxxxxxxxxxx' }).success,
    ).toBe(false);
    expect(EnginesSettingsSchema.safeParse({ engines: {}, token: 'x' }).success).toBe(false);
  });

  it('fallback: 자기 자신·없는 엔진 거부', () => {
    expect(() => parseEnginesSettings('engines:\n  a:\n    mode: apiKey\n    fallback: a\n')).toThrow(
      /자기 자신/,
    );
    expect(() => parseEnginesSettings('engines:\n  a:\n    mode: apiKey\n    fallback: [b]\n')).toThrow(
      /없습니다/,
    );
  });

  it('파일이 없으면 빈 설정, 있으면 읽는다', () => {
    const t = tempDir();
    try {
      expect(loadEnginesSettings(join(t.dir, 'none.yaml'))).toEqual({ engines: {} });
      const f = join(t.dir, 'engines-settings.yaml');
      writeFileSync(f, 'engines:\n  codex:\n    mode: subscription\n');
      expect(loadEnginesSettings(f).engines.codex?.mode).toBe('subscription');
    } finally {
      t.cleanup();
    }
  });
});
