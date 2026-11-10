import { describe, expect, it } from 'vitest';
import { findCycles, lintChecklist, type LintItem } from '../src/lint.js';

const it_ = (id: string, deps: string[] = []): LintItem => ({
  id,
  title: `항목 ${id} 작성`,
  artifactId: `art.item-${id}`,
  acceptance: [{ type: 'test' }],
  deps,
});

describe('21.5 R5 deps 순환 금지', () => {
  it('순환 거부 (2개·3개 순환)', () => {
    const res = lintChecklist([
      it_('a', ['b']),
      it_('b', ['a']),
      it_('c', ['d']),
      it_('d', ['e']),
      it_('e', ['c']),
    ]);
    expect(res.ok).toBe(false);
    const r5 = res.violations.filter((v) => v.rule === 'R5');
    expect(r5.map((v) => v.detail?.cycle)).toEqual([
      ['a', 'b', 'a'],
      ['c', 'd', 'e', 'c'],
    ]);
  });

  it('DAG는 통과 (다이아몬드 의존 포함)', () => {
    const res = lintChecklist([it_('a'), it_('b', ['a']), it_('c', ['a']), it_('d', ['b', 'c'])]);
    expect(res).toEqual({ ok: true, violations: [] });
    expect(findCycles([it_('x', ['missing'])])).toEqual([]);
  });

  it('자기 순환', () => {
    expect(findCycles([it_('a', ['a'])])).toEqual([['a', 'a']]);
  });
});
