import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcceptanceSchema, addAlias, loadDefaultGlossary, type Glossary } from '@harness-x/checklist-ledger';
import { afterAll, describe, expect, it } from 'vitest';
import { runLadder, type LadderExpected } from '../src/ladder.js';

interface Fixture {
  description: string;
  /** 지정 시 이 루트 문자열을 그대로 사용 (파일 생성 없음) */
  root?: string;
  expected: LadderExpected;
  files?: Record<string, string>;
  changes: { path: string; change: 'create' | 'modify' | 'delete' | 'rename'; form?: 'NFC' | 'NFD' }[];
  acceptance: unknown[];
  glossaryAdd?: Record<string, string[]>;
  expect: { level: number; verdict: string; actualPath?: string; escalate?: boolean };
}

const DIR = fileURLToPath(new URL('../fixtures/path-equivalence/', import.meta.url));
const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Fixture] as const);

const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

function glossaryFor(fx: Fixture): Glossary {
  let g = loadDefaultGlossary();
  for (const [canonical, aliases] of Object.entries(fx.glossaryAdd ?? {}))
    for (const a of aliases) g = addAlias(g, canonical, a);
  return g;
}

describe('25.6 회귀 픽스처 fixtures/path-equivalence/', () => {
  it('12종, 하네스/모바일 vs ai/mobile 포함', () => {
    expect(fixtures).toHaveLength(12);
    const regress = fixtures.find(([n]) => n.includes('harness-mobile-vs-ai-mobile'))?.[1];
    expect(regress?.expected.path).toBe('하네스/모바일');
    expect(regress?.changes[0]?.path.startsWith('ai/mobile/')).toBe(true);
  });

  it.each(fixtures)('%s', async (_name, fx) => {
    let root = fx.root;
    if (root === undefined) {
      root = mkdtempSync(join(tmpdir(), 'hx-ladder-fx-'));
      temps.push(root);
      for (const [p, c] of Object.entries(fx.files ?? {})) {
        mkdirSync(dirname(join(root, p)), { recursive: true });
        writeFileSync(join(root, p), c);
      }
    }
    const r = await runLadder({
      expected: fx.expected,
      changes: fx.changes.map((c) => ({ path: c.path.normalize(c.form ?? 'NFC'), change: c.change })),
      acceptance: fx.acceptance.map((a) => AcceptanceSchema.parse(a)),
      root,
      glossary: glossaryFor(fx),
    });
    expect({ level: r.level, verdict: r.verdict }).toEqual({
      level: fx.expect.level,
      verdict: fx.expect.verdict,
    });
    if (fx.expect.actualPath !== undefined) expect(r.actualPath).toBe(fx.expect.actualPath);
    if (fx.expect.escalate !== undefined) expect(r.escalate).toBe(fx.expect.escalate);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.reason.length).toBeGreaterThan(0);
  });
});
