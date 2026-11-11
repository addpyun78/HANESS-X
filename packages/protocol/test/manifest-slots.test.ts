import { describe, expect, expectTypeOf, it } from 'vitest';
import { PLUGIN_SLOTS, PluginSlotSchema, type PluginSlot } from '../src/manifest.js';

describe('플러그인 슬롯', () => {
  it('슬롯 타입 10종 (T-100 comparator 추가)', () => {
    expectTypeOf<PluginSlot>().toEqualTypeOf<
      | 'engine'
      | 'tool'
      | 'skill'
      | 'hook'
      | 'verifier'
      | 'pipeline'
      | 'panel'
      | 'memory'
      | 'command'
      | 'comparator'
    >();
    expect(PLUGIN_SLOTS).toHaveLength(10);
  });
  it('모르는 슬롯 거부', () => {
    expect(PluginSlotSchema.safeParse('widget').success).toBe(false);
  });
});
