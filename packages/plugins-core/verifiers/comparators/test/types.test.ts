import { describe, expect, expectTypeOf, it } from 'vitest';
import { CompareResultSchema, type CompareCtx, type CompareResult, type Comparator } from '../src/types.js';
import { ctx } from './helpers.js';

describe('B.1 Comparator 인터페이스', () => {
  it('kind · normalize(v, ctx) · equals(a, b, ctx): CompareResult', () => {
    expectTypeOf<Comparator['kind']>().toEqualTypeOf<string>();
    expectTypeOf<Comparator['normalize']>().parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf<Comparator['normalize']>().parameter(1).toEqualTypeOf<CompareCtx>();
    expectTypeOf<Comparator['normalize']>().returns.toEqualTypeOf<string>();
    expectTypeOf<Comparator['equals']>().parameter(2).toEqualTypeOf<CompareCtx>();
    expectTypeOf<Comparator['equals']>().returns.toEqualTypeOf<CompareResult>();
    const c: Comparator = {
      kind: 'same',
      normalize: (v) => String(v),
      equals: (a, b) => ({
        verdict: a === b ? 'equal' : 'uncertain',
        level: 'normalize',
        confidence: a === b ? 1 : 0,
        reason: 'test',
      }),
    };
    expect(CompareResultSchema.parse(c.equals('x', 'x', ctx())).verdict).toBe('equal');
  });
});
