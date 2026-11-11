import { describe, expect, it } from 'vitest';
import { satisfiesRange, parseVersion, versionComparator } from '../src/comparators/version.js';
import { ctx } from './helpers.js';

describe('C.10 version', () => {
  it('`v1.2` vs `1.2.0` equal', () => {
    expect(versionComparator.equals('v1.2', '1.2.0', ctx())).toMatchObject({
      verdict: 'equal',
      level: 'normalize',
    });
    expect(versionComparator.equals('1', 'v1.0.0', ctx()).verdict).toBe('equal');
    expect(versionComparator.equals('1.2.3+build.5', '1.2.3', ctx()).verdict).toBe('equal');
    expect(versionComparator.normalize('V2.1', ctx())).toBe('2.1.0');
  });
  it('다르면 different', () => {
    expect(versionComparator.equals('1.2.0', '1.3.0', ctx())).toMatchObject({
      verdict: 'different',
      diff: { at: 'version', expected: '1.2.0', actual: '1.3.0' },
    });
    expect(versionComparator.equals('1.2.0', '1.2.0-beta.1', ctx()).verdict).toBe('different');
  });
  it('range 옵션', () => {
    const r = (b: string, range: string) => versionComparator.equals('', b, ctx(), { range }).verdict;
    expect(r('1.4.2', '^1.2')).toBe('equal');
    expect(r('2.0.0', '^1.2')).toBe('different');
    expect(r('0.2.5', '^0.2.1')).toBe('equal');
    expect(r('0.3.0', '^0.2.1')).toBe('different');
    expect(r('1.2.9', '~1.2.3')).toBe('equal');
    expect(r('1.3.0', '~1.2.3')).toBe('different');
    expect(r('1.5.0', '>=1.2 <2')).toBe('equal');
    expect(r('1.9.9', '1.x')).toBe('equal');
    expect(r('3.0.0', '1.x || >=3')).toBe('equal');
    expect(r('1.0.0', 'banana')).toBe('different');
    expect(satisfiesRange(parseVersion('22.19.0')!, '>=22.19')).toBe(true);
  });
  it('버전으로 못 읽으면 uncertain', () => {
    expect(versionComparator.equals('최신', '1.0.0', ctx()).verdict).toBe('uncertain');
  });
});
