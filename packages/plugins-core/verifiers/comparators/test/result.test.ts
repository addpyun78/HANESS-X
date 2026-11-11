import { describe, expect, it } from 'vitest';
import { CompareResultSchema } from '../src/types.js';

describe('B.2 CompareResult (Zod)', () => {
  it('verdict·level 열거, confidence 0~1, reason 필수, diff 선택', () => {
    const ok = {
      verdict: 'different',
      level: 'normalize',
      confidence: 1,
      reason: '값 다름',
      diff: { at: '$.a', expected: 1, actual: 2 },
    };
    expect(CompareResultSchema.parse(ok)).toEqual(ok);
    for (const v of ['equal', 'different', 'uncertain'])
      for (const l of ['normalize', 'dictionary', 'semantic', 'human'])
        expect(
          CompareResultSchema.safeParse({ verdict: v, level: l, confidence: 0.5, reason: 'r' }).success,
        ).toBe(true);
    expect(CompareResultSchema.safeParse({ ...ok, verdict: 'same' }).success).toBe(false);
    expect(CompareResultSchema.safeParse({ ...ok, level: 'jury' }).success).toBe(false);
    expect(CompareResultSchema.safeParse({ ...ok, confidence: 1.2 }).success).toBe(false);
    expect(CompareResultSchema.safeParse({ ...ok, confidence: -0.1 }).success).toBe(false);
    expect(CompareResultSchema.safeParse({ ...ok, reason: '' }).success).toBe(false);
    expect(CompareResultSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    const { diff: _d, ...noDiff } = ok;
    expect(CompareResultSchema.safeParse(noDiff).success).toBe(true);
  });
});
