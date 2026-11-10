import { describe, expect, expectTypeOf, it } from 'vitest';
import { ENGINE_TARGETS, isEngineTarget, type EngineTarget } from '@harness-x/engine-scanner';

describe('10.1 대상 목록 상수', () => {
  it('티켓의 10개 CLI를 순서대로 담는다', () => {
    expect([...ENGINE_TARGETS]).toEqual([
      'claude',
      'codex',
      'agy',
      'gemini',
      'opencode',
      'cursor-agent',
      'qwen',
      'dsh',
      'claude-agent-acp',
      'codex-acp',
    ]);
    expect(new Set(ENGINE_TARGETS).size).toBe(ENGINE_TARGETS.length);
  });

  it('isEngineTarget 타입 가드', () => {
    expect(isEngineTarget('codex')).toBe(true);
    expect(isEngineTarget('vim')).toBe(false);
    expectTypeOf<EngineTarget>().toEqualTypeOf<(typeof ENGINE_TARGETS)[number]>();
  });
});
