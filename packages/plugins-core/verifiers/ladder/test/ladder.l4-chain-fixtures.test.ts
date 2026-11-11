import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcceptanceSchema, addAlias, loadDefaultGlossary, type Glossary } from '@harness-x/checklist-ledger';
import { afterAll, describe, expect, it } from 'vitest';
import { runLadder, type LadderExpected } from '../src/ladder.js';
import { runLadderL4 } from '../src/l4.js';
import { fakeChain, YES } from './judge-fakes.js';

/**
 * T-100 E.14 — 경로 사다리 L4가 judge 체인을 쓴다.
 * 기존 경로 픽스처 12종을 L1~L3 → L4(체인)로 끝까지 돌린다:
 *   같아야 하는 10종은 실패 판정 0 (L1·L2에서 끝나거나, 09 하네스/모바일 vs ai/mobile은 L4 체인이 인정)
 *   11 잘못된 대상 · 12 없음은 L3에서 확정 → 체인을 부르지 않는다
 */

interface Fixture {
  root?: string;
  expected: LadderExpected;
  files?: Record<string, string>;
  changes: { path: string; change: 'create' | 'modify' | 'delete' | 'rename'; form?: 'NFC' | 'NFD' }[];
  acceptance: unknown[];
  glossaryAdd?: Record<string, string[]>;
  expect: { level: number; verdict: string };
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

async function ladder(fx: Fixture) {
  let root = fx.root;
  if (root === undefined) {
    root = mkdtempSync(join(tmpdir(), 'hx-ladder-e14-'));
    temps.push(root);
    for (const [p, c] of Object.entries(fx.files ?? {})) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), c);
    }
  }
  return runLadder({
    expected: fx.expected,
    changes: fx.changes.map((c) => ({ path: c.path.normalize(c.form ?? 'NFC'), change: c.change })),
    acceptance: fx.acceptance.map((a) => AcceptanceSchema.parse(a)),
    root,
    glossary: glossaryFor(fx),
  });
}

const FAIL = new Set(['wrong', 'missing']);

describe('E.14 경로 사다리 L4 = judge 체인 (기존 경로 픽스처 + 하네스/모바일 vs ai/mobile)', () => {
  it('픽스처 12종 L1~L4: 같아야 하는 10종 실패 판정 0, 체인은 09번에서만 호출', async () => {
    expect(fixtures).toHaveLength(12);
    const { chain, backend } = fakeChain([YES, YES, YES]);
    const results: Record<string, { level: number; verdict: string }> = {};
    const callsBy: Record<string, number> = {};
    for (const [name, fx] of fixtures) {
      const before = backend.calls;
      const r = await runLadderL4(await ladder(fx), { judge: chain, itemTitle: name, sessionId: 'e14' });
      results[name] = { level: r.level, verdict: r.verdict };
      callsBy[name] = backend.calls - before;
    }
    const shouldPass = fixtures.filter(([, fx]) => !FAIL.has(fx.expect.verdict)).map(([n]) => n);
    expect(shouldPass).toHaveLength(10);
    const failures = shouldPass.filter((n) => FAIL.has(results[n]!.verdict));
    expect(failures).toEqual([]);

    const regress = '09-harness-mobile-vs-ai-mobile';
    expect(results[regress]).toEqual({ level: 4, verdict: 'equal' });
    expect(Object.entries(callsBy).filter(([, n]) => n > 0)).toEqual([[regress, 3]]);
    // 진짜 틀림·없음은 L3 결과 그대로 (체인이 바꾸지 않는다)
    expect(results['11-wrong-target']).toEqual({ level: 3, verdict: 'wrong' });
    expect(results['12-missing']).toEqual({ level: 3, verdict: 'missing' });
  });

  it('하네스/모바일 vs ai/mobile: 체인이 쓸 수 없으면(판정 AI 없음) 실패가 아니라 L5(승인 카드)로', async () => {
    const fx = fixtures.find(([n]) => n.includes('harness-mobile-vs-ai-mobile'))![1];
    const none = fakeChain([YES], {}, []);
    const r = await runLadderL4(await ladder(fx), { judge: none.chain, itemTitle: '모바일 앱' });
    expect(r).toMatchObject({ level: 4, decision: 'skipped', escalate: true, verdict: 'relocated' });
    expect(FAIL.has(r.verdict)).toBe(false);
    expect(none.backend.calls).toBe(0);
  });
});
