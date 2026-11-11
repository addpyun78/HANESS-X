import { describe, expect, it } from 'vitest';
import { numberComparator, parseNumber } from '../src/comparators/number.js';
import { ctx } from './helpers.js';

describe('C.9 number', () => {
  it('`1,000` vs `1000` equal (천 단위 구분자 제거)', () => {
    expect(numberComparator.equals('1,000', '1000', ctx())).toMatchObject({
      verdict: 'equal',
      level: 'normalize',
    });
    expect(numberComparator.equals('1_000_000', ' 1000000 ', ctx()).verdict).toBe('equal');
    expect(numberComparator.equals(1.5, '1.50', ctx()).verdict).toBe('equal');
    expect(numberComparator.normalize('12,345.5', ctx())).toBe('12345.5');
  });
  it('tolerance (기본 0)', () => {
    expect(numberComparator.equals('100', '100.4', ctx()).verdict).toBe('different');
    expect(numberComparator.equals('100', '100.4', ctx(), { tolerance: 0.5 }).verdict).toBe('equal');
    expect(numberComparator.equals('200', '500', ctx())).toMatchObject({
      verdict: 'different',
      diff: { at: 'number', expected: 200, actual: 500 },
    });
  });
  it('숫자가 아니면 uncertain, 잘못된 묶음 구분자는 숫자로 안 읽음', () => {
    expect(numberComparator.equals('열', '10', ctx()).verdict).toBe('uncertain');
    expect(parseNumber('1,00')).toBeNull();
    expect(parseNumber('-3e2')).toBe(-300);
  });
});
