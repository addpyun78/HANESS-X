import { describe, expect, expectTypeOf, it } from 'vitest';
import { HOOK_NAMES, HookBus, type HookName } from '../src/hooks.js';

describe('훅 이름', () => {
  it('8종 타입', () => {
    expectTypeOf<HookName>().toEqualTypeOf<
      | 'session.start'
      | 'prompt.submit'
      | 'tool.before'
      | 'tool.after'
      | 'turn.end'
      | 'stop.before'
      | 'context.compact'
      | 'item.verify'
    >();
    expect(HOOK_NAMES).toHaveLength(8);
  });
  it('모르는 훅 등록 거부', () => {
    const bus = new HookBus();
    expect(() => bus.onNotify('tool.whatever' as HookName, () => {})).toThrow();
  });
});
