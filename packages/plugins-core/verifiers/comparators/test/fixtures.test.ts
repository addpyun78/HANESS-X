import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultComparators } from '../src/registry.js';
import { compareValues, type SemanticMode } from '../src/compare.js';
import type { CompareOptions } from '../src/types.js';
import { ctx } from './helpers.js';

/**
 * T-100 G.1 회귀 픽스처 `fixtures/comparators/` — 비교기마다 같아야 5개 이상 + 달라야 3개 이상, 총 80개 이상.
 *   같아야: compareValues → verdict equal · next pass (의미 판단 없이 통과)
 *   달라야: verdict가 equal이 아니고 next가 pass가 아님 (자동으로 통과하지 않는다)
 */

interface Case {
  name: string;
  expected: unknown;
  actual: unknown;
  expect: 'equal' | 'different';
  options?: CompareOptions;
  semantic?: SemanticMode;
  /** 실제값을 이 형식으로 바꿔 넣는다 (한글 NFD 등) */
  actualForm?: 'NFC' | 'NFD';
}
interface FixtureFile {
  kind: string;
  cases: Case[];
}

const DIR = fileURLToPath(new URL('../../../../../fixtures/comparators/', import.meta.url));
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as FixtureFile);
const rows = files.flatMap((f) => f.cases.map((c) => [f.kind, c.name, c] as const));

const actualOf = (c: Case) =>
  typeof c.actual === 'string' && c.actualForm ? c.actual.normalize(c.actualForm) : c.actual;

describe('G.1 fixtures/comparators/ — 비교기별 같아야 5 + 달라야 3 이상, 총 80 이상', () => {
  it('기본 비교기 전부에 픽스처가 있고 개수 조건을 채운다', () => {
    expect(files.map((f) => f.kind).sort()).toEqual(defaultComparators.kinds().sort());
    for (const f of files) {
      const eq = f.cases.filter((c) => c.expect === 'equal').length;
      const df = f.cases.filter((c) => c.expect === 'different').length;
      expect({ kind: f.kind, eq: eq >= 5, df: df >= 3, total: f.cases.length >= 8 }).toEqual({
        kind: f.kind,
        eq: true,
        df: true,
        total: true,
      });
    }
    expect(rows.length).toBeGreaterThanOrEqual(80);
  });

  it.each(rows)('%s: %s', (kind, _name, c) => {
    const r = compareValues(kind, c.expected, actualOf(c), ctx(), {
      ...(c.options ? { options: c.options } : {}),
      ...(c.semantic ? { semantic: c.semantic } : {}),
    });
    if (c.expect === 'equal') {
      expect({ verdict: r.verdict, next: r.next }).toEqual({ verdict: 'equal', next: 'pass' });
    } else {
      expect(r.verdict).not.toBe('equal');
      expect(r.next).not.toBe('pass');
    }
  });
});
