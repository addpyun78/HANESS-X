import { describe, expect, it } from 'vitest';
import { exitCodeComparator } from '../src/comparators/exit-code.js';
import { ctx } from './helpers.js';

describe('C.12 exitCode — 숫자 비교, 정규화 없음', () => {
  it('0 vs 0 equal', () => {
    expect(exitCodeComparator.equals(0, 0, ctx())).toMatchObject({
      verdict: 'equal',
      level: 'normalize',
      confidence: 1,
    });
    expect(exitCodeComparator.equals('0', 0, ctx()).verdict).toBe('equal');
  });
  it('다르면 different, 정수가 아니면 different (공백도 정규화 안 함)', () => {
    expect(exitCodeComparator.equals(0, 1, ctx())).toMatchObject({
      verdict: 'different',
      diff: { at: 'exitCode', expected: 0, actual: 1 },
    });
    expect(exitCodeComparator.equals(0, ' 0', ctx()).verdict).toBe('different');
    expect(exitCodeComparator.equals(0, null, ctx()).verdict).toBe('different');
  });
});
