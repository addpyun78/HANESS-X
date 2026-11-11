import { describe, expect, it } from 'vitest';
import { pathComparator } from '../src/comparators/path.js';
import { ctx } from './helpers.js';

const eq = (a: string, b: string, c = ctx(), o = {}) => pathComparator.equals(a, b, c, o);

describe('C.3 path 구분자: - · _ 차이는 사전 허용 규칙이 있을 때만', () => {
  it('미등록 uncertain, 등록 후 equal', () => {
    const before = eq('src/my-app/user_list.ts', 'src/my_app/user-list.ts');
    expect(before).toMatchObject({ verdict: 'uncertain', level: 'dictionary' });
    expect(before.reason).toMatch(/path\.dash-underscore/);
    const after = eq(
      'src/my-app/user_list.ts',
      'src/my_app/user-list.ts',
      ctx({}, { rules: ['path.dash-underscore'] }),
    );
    expect(after).toMatchObject({ verdict: 'equal', level: 'dictionary' });
  });
});
