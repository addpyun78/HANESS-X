// T-102 E.C2-005.1 재현·재발 방지: 늘 통과하는 의미 없는 단언(상수끼리 비교하는 expect 등)이 테스트에 없어야 한다
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const TRIVIAL =
  /expect\(\s*(true|false|1|0|null|undefined)\s*\)\s*\.(toBe|toEqual|toStrictEqual)\(\s*(true|false|1|0|null|undefined)\s*\)|expect\(\s*true\s*\)\.toBeTruthy\(\)/;

describe('의미 없는 단언 금지 (T-102 C2-005)', () => {
  it('테스트 파일에 상수끼리 비교하는 단언이 0개', () => {
    const files = execFileSync('git', ['ls-files', '*.test.ts', '*.test.tsx'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
    const hits = files.filter(
      (f) =>
        f !== 'tests/audit/no-trivial-assert.test.ts' && TRIVIAL.test(readFileSync(`${root}/${f}`, 'utf8')),
    );
    expect(hits).toEqual([]);
  });
});
