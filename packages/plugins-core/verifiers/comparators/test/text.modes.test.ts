import { describe, expect, it } from 'vitest';
import { textComparator } from '../src/comparators/text.js';
import { ctx } from './helpers.js';

describe('C.5 text 모드 equals / contains / lines', () => {
  it('equals', () => {
    expect(textComparator.equals('a\nb', 'a\r\nb', ctx(), { mode: 'equals' }).verdict).toBe('equal');
    expect(textComparator.equals('a', 'a b', ctx(), { mode: 'equals' }).verdict).toBe('uncertain');
  });
  it('contains', () => {
    expect(
      textComparator.equals('Tests  passed', 'run…\r\n12 Tests passed  \r\n', ctx(), { mode: 'contains' })
        .verdict,
    ).toBe('equal');
    expect(textComparator.equals('passed', 'failed', ctx(), { mode: 'contains' }).verdict).toBe('uncertain');
  });
  it('lines (순서 그대로 / ignoreOrder)', () => {
    expect(textComparator.equals('a\nb', 'a\r\nb\r\n', ctx(), { mode: 'lines' }).verdict).toBe('equal');
    expect(textComparator.equals('a\nb', 'b\na', ctx(), { mode: 'lines' }).verdict).toBe('uncertain');
    expect(textComparator.equals('a\nb', 'b\na', ctx(), { mode: 'lines', ignoreOrder: true }).verdict).toBe(
      'equal',
    );
    const miss = textComparator.equals('a\nb\nc', 'b\na', ctx(), { mode: 'lines', ignoreOrder: true });
    expect(miss.verdict).toBe('uncertain');
    expect(miss.diff).toEqual({ at: 'lines', expected: ['c'] });
  });
});
