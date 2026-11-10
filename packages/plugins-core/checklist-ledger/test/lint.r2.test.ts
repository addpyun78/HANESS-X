import { describe, expect, it } from 'vitest';
import { lintItem, type LintItem } from '../src/lint.js';

const r2 = (artifactId: LintItem['artifactId']) =>
  lintItem({ id: '1', title: '로그인 화면 작성', artifactId, acceptance: [{ type: 'test' }] }).filter(
    (v) => v.rule === 'R2',
  );

describe('21.2 R2 산출물 1개', () => {
  it('2개 지정 거부', () => {
    const v = r2(['art.login', 'art.signup']);
    expect(v).toHaveLength(1);
    expect(v[0]!.detail).toEqual({ artifactIds: ['art.login', 'art.signup'] });
    expect(r2('art.login, art.signup')).toHaveLength(1);
  });
  it('없음 거부', () => {
    expect(r2(undefined)).toHaveLength(1);
    expect(r2(null)).toHaveLength(1);
    expect(r2([])).toHaveLength(1);
    expect(r2('')).toHaveLength(1);
  });
  it('정확히 1개 통과', () => {
    expect(r2('art.login')).toEqual([]);
    expect(r2(['art.login'])).toEqual([]);
  });
});
