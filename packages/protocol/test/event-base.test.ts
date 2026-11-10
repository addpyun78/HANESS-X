import { describe, expectTypeOf, it, expect } from 'vitest';
import { EventBaseSchema, type EventBase } from '../src/events.js';

describe('EventBase', () => {
  it('필드 타입', () => {
    expectTypeOf<EventBase>().toEqualTypeOf<{
      id: string;
      ts: string;
      sessionId: string;
      engineId?: string | undefined;
      itemId?: string | undefined;
    }>();
  });
  it('선택 필드 생략 가능', () => {
    expect(EventBaseSchema.parse({ id: 'e1', ts: '2026-11-10T00:00:00Z', sessionId: 's1' })).toBeTruthy();
  });
});
