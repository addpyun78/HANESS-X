import { describe, expect, it } from 'vitest';
import { regexComparator } from '../src/comparators/regex.js';
import { ctx } from './helpers.js';

describe('C.11 regex — 기존 정규식을 정규화된 텍스트에 적용', () => {
  it('CRLF 출력에서 기존 정규식 통과', () => {
    const out = 'Running 12 tests\r\nTests: 12 passed  \r\n\r\n';
    // 정규화 전에는 $ 앞에 \r·공백이 있어 실패하던 정규식
    expect(/^Tests: \d+ passed$/m.test(out)).toBe(false);
    expect(regexComparator.equals('/^Tests: \\d+ passed$/m', out, ctx())).toMatchObject({
      verdict: 'equal',
      level: 'normalize',
    });
    expect(regexComparator.equals('passed$', 'all passed\r\n', ctx()).verdict).toBe('equal');
  });
  it('불일치·잘못된 정규식 → different, 공백 개수는 기본 유지', () => {
    expect(regexComparator.equals('/^ok$/', 'error', ctx()).verdict).toBe('different');
    expect(regexComparator.equals('(', 'x', ctx()).reason).toMatch(/정규식 오류/);
    expect(regexComparator.equals('a {2}b', 'a  b', ctx()).verdict).toBe('equal');
    expect(regexComparator.equals('ERROR', 'error', ctx(), { flags: 'i' }).verdict).toBe('equal');
  });
});
