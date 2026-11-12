import { describe, expect, it } from 'vitest';
import { engineIdOfBin, MainAiSchema, ModelOptionSchema, ModelsResponseSchema } from '../src/index.js';

describe('T-101 5B.1 ModelOption 스키마', () => {
  const ok = {
    engineId: 'claude-code',
    modelId: 'sonnet',
    displayName: 'Sonnet',
    auth: 'subscription',
    inputs: { image: true, pdf: true, audio: false },
    status: 'ready',
  } as const;

  it('필수 필드: engineId·modelId·displayName·auth·inputs{image,pdf,audio}·status', () => {
    expect(ModelOptionSchema.parse(ok)).toEqual(ok);
    for (const k of Object.keys(ok)) {
      const bad = { ...ok } as Record<string, unknown>;
      delete bad[k];
      expect(ModelOptionSchema.safeParse(bad).success, k).toBe(false);
    }
  });

  it('auth는 subscription|api|local, status는 ready|needs-login|unavailable만', () => {
    for (const auth of ['subscription', 'api', 'local'])
      expect(ModelOptionSchema.safeParse({ ...ok, auth }).success).toBe(true);
    expect(ModelOptionSchema.safeParse({ ...ok, auth: 'apiKey' }).success).toBe(false);
    for (const status of ['ready', 'needs-login', 'unavailable'])
      expect(ModelOptionSchema.safeParse({ ...ok, status }).success).toBe(true);
    expect(ModelOptionSchema.safeParse({ ...ok, status: 'ok' }).success).toBe(false);
  });

  it('inputs는 세 가지 모두 boolean, 모르는 필드는 거부(strict)', () => {
    expect(ModelOptionSchema.safeParse({ ...ok, inputs: { image: true, pdf: true } }).success).toBe(false);
    expect(ModelOptionSchema.safeParse({ ...ok, inputs: { ...ok.inputs, video: true } }).success).toBe(false);
    expect(ModelOptionSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(
      ModelOptionSchema.safeParse({ ...ok, engineLabel: 'Claude Code', source: 'default' }).success,
    ).toBe(true);
  });

  it('응답·메인 AI 스키마, 스캐너 이름 → 엔진 id', () => {
    expect(ModelsResponseSchema.parse({ models: [ok], scannedAt: null }).models).toHaveLength(1);
    expect(MainAiSchema.parse({ engine: 'codex' })).toEqual({ engine: 'codex' });
    expect(MainAiSchema.safeParse({ engine: '' }).success).toBe(false);
    expect([engineIdOfBin('claude'), engineIdOfBin('agy'), engineIdOfBin('opencode')]).toEqual([
      'claude-code',
      'antigravity',
      'opencode',
    ]);
  });
});
