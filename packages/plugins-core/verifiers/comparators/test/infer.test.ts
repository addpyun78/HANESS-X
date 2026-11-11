import { describe, expect, it } from 'vitest';
import { inferCompareKind } from '../src/infer.js';

describe('D.2 kind 자동 추론 (10케이스)', () => {
  const cases: [string, unknown, string][] = [
    ['상대 경로', 'src/app/main.ts', 'path'],
    ['Windows 경로', 'C:\\work\\app', 'path'],
    ['한글 폴더 경로', '하네스/모바일', 'path'],
    ['파일 이름', 'README.md', 'path'],
    ['JSON 객체 문자열', '{"status":"ok"}', 'json'],
    ['JSON 배열 값', [1, 2], 'json'],
    ['천 단위 숫자', '1,000', 'number'],
    ['semver(v 접두)', 'v1.2', 'version'],
    ['semver(세 자리)', '1.2.3-beta.1', 'version'],
    ['그 밖의 문장', '작업이 끝났습니다', 'text'],
  ];
  it.each(cases)('%s', (_n, v, want) => {
    expect(inferCompareKind(v)).toBe(want);
  });
  it('겹치는 경우: `1.2`는 숫자, URL·공백 있는 문장은 text', () => {
    expect(inferCompareKind('1.2')).toBe('number');
    expect(inferCompareKind(42)).toBe('number');
    expect(inferCompareKind('https://example.com/a')).toBe('text');
    expect(inferCompareKind('build ok')).toBe('text');
    expect(inferCompareKind('{not json')).toBe('text');
  });
});
