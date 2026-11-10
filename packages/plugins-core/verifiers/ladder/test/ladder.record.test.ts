import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChecklistLedger, VerdictSchema, loadDefaultGlossary } from '@harness-x/checklist-ledger';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { runLadder, type LadderResult } from '../src/ladder.js';
import { recordLadderEvidence, toEvidence, toVerdict } from '../src/record.js';

const glossary = loadDefaultGlossary();
const now = () => new Date('2026-11-10T00:00:00.000Z');

describe('25.5 판정 결과 타입 기록', () => {
  let root = '';
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('{level, verdict, confidence, reason} 타입', () => {
    expectTypeOf<LadderResult['verdict']>().toEqualTypeOf<'equal' | 'relocated' | 'wrong' | 'missing'>();
    expectTypeOf<LadderResult['level']>().toEqualTypeOf<1 | 2 | 3>();
  });

  it('L1·L2·L3 결과의 evidence 스냅샷 + 원장 항목에 기록', async () => {
    root = mkdtempSync(join(tmpdir(), 'hx-ladder-rec-'));
    mkdirSync(join(root, 'ws', 'ai', 'mobile'), { recursive: true });
    writeFileSync(join(root, 'ws', 'ai', 'mobile', 'MainActivity.kt'), 'class MainActivity');
    const ws = join(root, 'ws');
    const acceptance = [{ type: 'symbol' as const, symbol: 'MainActivity' }];

    const l1 = await runLadder({
      expected: { path: 'harness/mobile', kind: 'dir' },
      changes: ['harness\\mobile\\a.kt'],
      acceptance,
      root: ws,
      glossary,
    });
    const l2 = await runLadder({
      expected: { path: '하네스/모바일', kind: 'dir' },
      changes: ['harness/mobile/a.kt'],
      acceptance,
      root: ws,
      glossary,
    });
    const l3 = await runLadder({
      expected: { path: '하네스/모바일', kind: 'dir' },
      changes: [{ path: 'ai/mobile/MainActivity.kt', change: 'create' }],
      acceptance,
      root: ws,
      glossary,
    });
    const evidence = [l1, l2, l3].map((r) => toEvidence(r, { now }));
    expect(evidence).toMatchSnapshot();
    for (const r of [l1, l2, l3]) expect(VerdictSchema.parse(toVerdict(r))).toEqual(toVerdict(r));

    const ledger = new ChecklistLedger({ dir: join(root, 'state'), sessionId: 's1', now });
    ledger.create([
      { id: '1', title: '모바일 앱 골격 작성', artifactId: 'art.mobile-app', acceptance: [...acceptance] },
    ]);
    recordLadderEvidence(ledger, '1', l3, { now, expectedVersion: 1 });
    expect(ledger.item('1').evidence).toEqual([evidence[2]]);
  });
});
