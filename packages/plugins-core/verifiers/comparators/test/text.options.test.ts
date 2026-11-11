import { describe, expect, it } from 'vitest';
import { textComparator } from '../src/comparators/text.js';
import { ctx } from './helpers.js';

describe('C.6 text 옵션 ignoreCase (기본 꺼짐)', () => {
  it('기본은 대소문자 구분, 켜면 무시', () => {
    expect(textComparator.equals('DONE', 'done', ctx()).verdict).toBe('uncertain');
    expect(textComparator.equals('DONE', 'done', ctx(), { ignoreCase: true }).verdict).toBe('equal');
    expect(textComparator.equals('OK', 'all ok', ctx(), { mode: 'contains', ignoreCase: true }).verdict).toBe(
      'equal',
    );
    expect(textComparator.normalize('AbC', ctx(), { ignoreCase: true })).toBe('abc');
  });
});
