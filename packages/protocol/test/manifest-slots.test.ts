import { describe, expect, expectTypeOf, it } from 'vitest';
import { PLUGIN_SLOTS, PluginSlotSchema, type PluginSlot } from '../src/manifest.js';

describe('플러그인 슬롯', () => {
  it('슬롯 타입 9종', () => {
    expectTypeOf<PluginSlot>().toEqualTypeOf<
      'engine' | 'tool' | 'skill' | 'hook' | 'verifier' | 'pipeline' | 'panel' | 'memory' | 'command'
    >();
    expect(PLUGIN_SLOTS).toHaveLength(9);
  });
  it('모르는 슬롯 거부', () => {
    expect(PluginSlotSchema.safeParse('widget').success).toBe(false);
  });
});
