import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  AcceptanceSchema,
  ChecklistLedger,
  Escalator,
  ManifestStore,
  loadDefaultGlossary,
  loadGlossary,
  type Acceptance,
} from '@harness-x/checklist-ledger';
import { afterEach, describe, expect, it } from 'vitest';
import { runLadder } from '../src/ladder.js';
import { runLadderL4 } from '../src/l4.js';

describe('27.4 "동치 인정" → glossary·manifest 별칭 자동 추가 → 같은 케이스 재판정이 L2에서 종료', () => {
  let root = '';
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('하네스/모바일 vs ai/mobile: L3 relocated → L4 off → L5 승인 카드 → 동치 인정 → L2', async () => {
    root = mkdtempSync(join(tmpdir(), 'hx-ladder-l5-'));
    const write = (p: string, c: string) => {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), c);
    };
    write('ai/mobile/MainActivity.kt', 'class MainActivity');
    const hx = join(root, '.harness-x');
    const glossaryFile = join(hx, 'glossary.json');
    const manifest = new ManifestStore({ dir: hx });
    manifest.lock([{ artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' }], {
      glossary: loadDefaultGlossary(),
    });
    const acceptance: Acceptance[] = [
      AcceptanceSchema.parse({ type: 'symbol', symbol: 'class MainActivity' }),
    ];
    const ledger = new ChecklistLedger({ dir: hx, sessionId: 's1' });
    ledger.create([{ id: '1', title: '모바일 앱 스캐폴드', artifactId: 'art.mobile-app', acceptance }]);
    ledger.transition('1', 'doing');
    ledger.transition('1', 'verifying');

    const expected = () => {
      const e = manifest.resolve('art.mobile-app');
      return { path: e.path, kind: e.kind, aliases: e.aliases ?? [] };
    };
    const changes = [{ path: join(root, 'ai/mobile/MainActivity.kt'), change: 'create' as const }];
    const judge = (glossary = loadDefaultGlossary()) =>
      runLadder({ expected: expected(), changes, acceptance, root, glossary });

    const l3 = await judge();
    expect(l3).toMatchObject({ level: 3, verdict: 'relocated', escalate: true, actualPath: 'ai/mobile' });
    const l4 = await runLadderL4(l3, { judge: null, itemTitle: '모바일 앱 스캐폴드' });
    expect(l4).toMatchObject({ level: 4, escalate: true });

    const esc = new Escalator({ dir: hx, sessionId: 's1', ledger, manifest, glossaryFile });
    const out = await esc.escalate({
      itemId: '1',
      artifactId: 'art.mobile-app',
      itemTitle: '모바일 앱 스캐폴드',
      expectedPath: l4.expectedPath,
      actualPath: l4.actualPath!,
      reason: l4.reason,
    });
    expect(out.status).toBe('pending');
    const res = esc.resolve(out.status === 'pending' ? out.approvalId : '', 'equivalent');
    expect(res).toMatchObject({ itemId: '1', status: 'done', learned: { manifestAlias: true } });
    expect(res.learned?.glossaryAliases).toEqual([{ canonical: 'harness', alias: 'ai' }]);

    // 사전에 기록됨
    expect(manifest.resolve('art.mobile-app').aliases).toEqual(['ai/mobile']);
    const g = loadGlossary(glossaryFile);
    expect(g.terms.find((t) => t.canonical === 'harness')?.aliases).toEqual(['하네스', 'ai']);

    // 같은 케이스 재판정 → L2에서 끝난다 (manifest 별칭 / glossary 각각으로도)
    expect(await judge(g)).toMatchObject({ level: 2, verdict: 'equal', escalate: false });
    expect(await judge()).toMatchObject({
      level: 2,
      verdict: 'equal',
      reason: expect.stringContaining('manifest'),
    });
    expect(
      await runLadder({
        expected: { path: 'harness/mobile', kind: 'dir' },
        changes,
        acceptance,
        root,
        glossary: g,
      }),
    ).toMatchObject({ level: 2, reason: expect.stringContaining('glossary') });
  });
});
