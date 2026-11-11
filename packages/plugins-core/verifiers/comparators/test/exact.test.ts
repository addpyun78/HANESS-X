import { describe, expect, it } from 'vitest';
import { exactComparator } from '../src/comparators/exact.js';
import { ctx } from './helpers.js';

describe('C.1 exact (정규화 없음)', () => {
  it('"a " vs "a" → different', () => {
    const r = exactComparator.equals('a ', 'a', ctx());
    expect(r).toMatchObject({ verdict: 'different', level: 'normalize', confidence: 1 });
    expect(r.diff?.at).toBe('char 1');
  });
  it('글자 그대로 같으면 equal, CRLF·대소문자 차이도 different, uncertain 없음', () => {
    expect(exactComparator.equals('a', 'a', ctx()).verdict).toBe('equal');
    expect(exactComparator.equals('ok\r\n', 'ok\n', ctx()).verdict).toBe('different');
    expect(exactComparator.equals('A', 'a', ctx()).verdict).toBe('different');
    expect(exactComparator.normalize(' a\r\n', ctx())).toBe(' a\r\n');
  });
});
