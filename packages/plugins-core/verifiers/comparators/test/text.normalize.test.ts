import { describe, expect, it } from 'vitest';
import { normalizeText, textComparator } from '../src/comparators/text.js';
import { ctx } from './helpers.js';

const NFD = '한글'.normalize('NFD');

describe('C.4 text 정규화 (15케이스)', () => {
  const cases: [string, string, string][] = [
    ['CRLF → LF', 'a\r\nb', 'a\nb'],
    ['CR 단독 → LF', 'a\rb', 'a\nb'],
    ['줄 끝 공백 제거', 'a  \nb\t', 'a\nb'],
    ['마지막 빈 줄 제거', 'a\n\n\n', 'a'],
    ['마지막 공백 줄 제거', 'a\n  \n\t\n', 'a'],
    ['CRLF 끝 빈 줄', 'ok\r\n\r\n', 'ok'],
    ['NFC (맥 NFD 한글)', NFD, '한글'],
    ['연속 공백 1개', 'a    b', 'a b'],
    ['탭 섞인 연속 공백', 'a \t b', 'a b'],
    ['NBSP 연속', 'a\u00a0\u00a0b', 'a b'],
    ['앞쪽 들여쓰기도 1개로', '    x', ' x'],
    ['중간 빈 줄은 유지', 'a\n\nb', 'a\n\nb'],
    ['단일 공백 그대로', 'a b', 'a b'],
    ['빈 문자열', '', ''],
    ['대소문자는 기본 유지', 'Done', 'Done'],
  ];
  it.each(cases)('%s', (_n, input, want) => {
    expect(normalizeText(input)).toBe(want);
  });
  it('collapseSpaces: false면 연속 공백 유지', () => {
    expect(normalizeText('a    b', { collapseSpaces: false })).toBe('a    b');
  });
  it('정규화로 같아지면 equal(normalize), 아니면 uncertain', () => {
    expect(textComparator.equals('build ok\n', 'build  ok\r\n\r\n', ctx())).toMatchObject({
      verdict: 'equal',
      level: 'normalize',
    });
    expect(textComparator.equals('완료', '작업이 끝났습니다', ctx())).toMatchObject({
      verdict: 'uncertain',
      confidence: 0,
    });
    expect(
      textComparator.equals(
        '완료',
        '작업이 끝났습니다',
        ctx({}, { pairs: [{ kind: 'text', a: '완료', b: '작업이 끝났습니다' }] }),
      ),
    ).toMatchObject({ verdict: 'equal', level: 'dictionary' });
  });
});
