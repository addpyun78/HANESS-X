import { describe, expect, it } from 'vitest';
import { HarnessEventSchema, HARNESS_EVENT_TYPES } from '../src/events.js';
import { invalidSamples, validSamples } from './fixtures/event-samples.js';

describe('HarnessEvent Zod 스키마', () => {
  it('샘플이 9종을 모두 덮는다', () => {
    expect(new Set(validSamples.map((s) => s.type))).toEqual(new Set(HARNESS_EVENT_TYPES));
    expect(new Set(invalidSamples.map((s) => s.type))).toEqual(new Set(HARNESS_EVENT_TYPES));
  });
  it.each(validSamples.map((s) => [s.type, s] as const))('정상 %s parse 성공', (_t, sample) => {
    expect(HarnessEventSchema.safeParse(sample).success).toBe(true);
  });
  it.each(invalidSamples.map((s) => [s.type, s] as const))('잘못된 %s parse 실패', (_t, sample) => {
    expect(HarnessEventSchema.safeParse(sample).success).toBe(false);
  });
});
