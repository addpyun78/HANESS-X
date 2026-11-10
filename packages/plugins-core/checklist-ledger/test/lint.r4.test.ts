import { describe, expect, it } from 'vitest';
import { lintItem, type LintItem, type LintOptions } from '../src/lint.js';

const r4 = (estimate: LintItem['estimate'], opts?: LintOptions) =>
  lintItem(
    { id: '1', title: '로그인 화면 작성', artifactId: 'art.login', acceptance: [{ type: 'test' }], estimate },
    opts,
  ).filter((v) => v.rule === 'R4');

describe('21.4 R4 크기 상한 (파일 1개 또는 diff 150줄)', () => {
  it.each([
    [{ files: 1 }],
    [{ diffLines: 150 }],
    [{ files: 1, diffLines: 400 }],
    [{ files: 3, diffLines: 120 }],
    [{}],
    [undefined],
  ])('통과: %j', (e) => {
    expect(r4(e)).toEqual([]);
  });

  it.each([[{ files: 2 }], [{ diffLines: 151 }], [{ files: 4, diffLines: 600 }]])('거부: %j', (e) => {
    const v = r4(e);
    expect(v).toHaveLength(1);
    expect(v[0]!.detail).toMatchObject({ maxFiles: 1, maxDiffLines: 150 });
  });

  it('상한 설정 가능', () => {
    expect(r4({ files: 2 }, { maxFiles: 2 })).toEqual([]);
    expect(r4({ diffLines: 100 }, { maxDiffLines: 50 })).toHaveLength(1);
  });
});
