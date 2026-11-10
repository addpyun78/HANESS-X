import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lintChecklist, type LintItem, type LintRuleId } from '../src/lint.js';

interface Sample {
  name: string;
  expectRules: LintRuleId[];
  items: LintItem[];
}

const samples = JSON.parse(
  readFileSync(new URL('../fixtures/non-atomic.json', import.meta.url), 'utf8'),
) as Sample[];

describe('21.7 비원자 샘플 픽스처', () => {
  it('샘플 10개', () => {
    expect(samples).toHaveLength(10);
  });

  it.each(samples.map((s) => [s.name, s] as const))('거부: %s', (_name, s) => {
    const res = lintChecklist(s.items);
    expect(res.ok).toBe(false);
    expect([...new Set(res.violations.map((v) => v.rule))].sort()).toEqual([...s.expectRules].sort());
  });

  it('대조군: 원자적 항목은 통과', () => {
    const res = lintChecklist([
      { id: '1', title: '로그인 화면 작성', artifactId: 'art.login', acceptance: [{ type: 'test' }] },
      {
        id: '2',
        title: '로그인 테스트 작성',
        artifactId: 'art.login-test',
        acceptance: [{ type: 'test' }, { type: 'llm' }],
        deps: ['1'],
        estimate: { files: 1, diffLines: 80 },
      },
    ]);
    expect(res).toEqual({ ok: true, violations: [] });
  });
});
