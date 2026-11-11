import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  AcceptanceSchema,
  ManifestStore,
  loadDefaultGlossary,
  loadGlossary,
  type Acceptance,
} from '@harness-x/checklist-ledger';
import { afterEach, describe, expect, it } from 'vitest';
import { runLadder, type LadderResult } from '../src/ladder.js';
import { decideL4, learnL4Alias, runLadderL4, type L4Judge, type L4Result } from '../src/l4.js';
import { toEvidence } from '../src/record.js';
import { fakeChain, NO, YES } from './judge-fakes.js';

const prev: LadderResult = {
  level: 3,
  verdict: 'relocated',
  confidence: 0.82,
  reason: 'acceptance가 후보 경로 ai/mobile에서 통과',
  expectedPath: 'harness/mobile',
  actualPath: 'ai/mobile',
  candidates: [{ path: 'ai/mobile', similarity: 0.8 } as LadderResult['candidates'][number]],
  escalate: true,
};

/** 표본 3개 답 → 체인 → L4 */
const l4 = async (answers: (typeof YES)[]) =>
  (await runLadderL4(prev, { judge: fakeChain(answers).chain, itemTitle: '모바일 앱' })) as L4Result;

describe('E.14 L4는 judge 체인을 쓴다 (체인 임계값 ≥0.9 인정 · 0.6~0.9 L5 · <0.6 실패)', () => {
  it('3/3 예 → 인정(equal), 2/3 → L5, 0/3 → 실패', async () => {
    expect(await l4([YES, YES, YES])).toMatchObject({
      level: 4,
      decision: 'accept',
      verdict: 'equal',
      confidence: 1,
      escalate: false,
      verifierId: 'codex',
    });
    expect(await l4([YES, YES, NO])).toMatchObject({
      decision: 'escalate',
      escalate: true,
      confidence: 0.667,
    });
    expect(await l4([NO, NO, NO])).toMatchObject({
      decision: 'fail',
      verdict: 'wrong',
      confidence: 1,
      escalate: false,
    });
    const missing = { ...NO, difference_kind: 'missing' as const };
    expect(await l4([missing, missing, missing])).toMatchObject({ decision: 'fail', verdict: 'missing' });
  });

  it('체인 결정 → L4 결정 대응', () => {
    expect(decideL4({ verdict: 'equal' })).toBe('accept');
    expect(decideL4({ verdict: 'different' })).toBe('fail');
    expect(decideL4({ verdict: 'uncertain' })).toBe('escalate');
    expect(decideL4({ verdict: 'unavailable' })).toBe('skipped');
  });

  it('L3에서 확정된 결과는 건너뜀, 판정할 AI 없음·체인 오류는 L5', async () => {
    const done: LadderResult = { ...prev, level: 2, verdict: 'equal', escalate: false };
    const f = fakeChain([YES]);
    expect(await runLadderL4(done, { judge: f.chain, itemTitle: 't' })).toBe(done);
    expect(f.backend.calls).toBe(0);

    const none = fakeChain([YES], {}, []); // 엔진 없음 + Ollama 꺼짐 → no-judge
    expect(await runLadderL4(prev, { judge: none.chain, itemTitle: 't' })).toMatchObject({
      level: 4,
      decision: 'skipped',
      escalate: true,
      verdict: 'relocated',
    });
    const broken: L4Judge = {
      judge: () => Promise.resolve({ verdict: 'unavailable', confidence: 0, reason: 'error' }),
    };
    expect(await runLadderL4(prev, { judge: broken, itemTitle: 't' })).toMatchObject({ decision: 'skipped' });
  });

  it('체인에 보내는 것: path 비교 · 기대/실제 경로 · 항목 제목만, evidence 기록', async () => {
    const f = fakeChain([YES, YES, YES]);
    const r = await runLadderL4(prev, { judge: f.chain, itemTitle: '모바일 앱', sessionId: 's1' });
    expect(f.backend.calls).toBe(3);
    const user = f.backend.prompts[0]!.user;
    expect(user).toContain('harness/mobile');
    expect(user).toContain('ai/mobile');
    expect(user).toContain('모바일 앱');
    expect(toEvidence(r, { now: () => new Date('2026-01-01T00:00:00Z') })).toMatchObject({
      kind: 'ladder_verdict',
      level: 4,
      verdict: 'equal',
      decision: 'accept',
      escalate: false,
    });
  });
});

describe('26.5 인정 시 별칭 자동 추가 → 다음 판정은 L2', () => {
  let root = '';
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('하네스/모바일 vs ai/mobile: L3 relocated → L4(체인) 인정 → manifest·glossary 별칭 → 재판정 L2', async () => {
    root = mkdtempSync(join(tmpdir(), 'hx-ladder-l4-'));
    const write = (p: string, c: string) => {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), c);
    };
    write('ai/mobile/MainActivity.kt', 'class MainActivity');
    const glossaryFile = join(root, '.harness-x', 'glossary.json');
    const manifest = new ManifestStore({ dir: join(root, '.harness-x') });
    manifest.lock([{ artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' }], {
      glossary: loadDefaultGlossary(),
    });
    const expectedPath = manifest.resolve('art.mobile-app').path;
    expect(expectedPath).toBe('harness/mobile');
    const acceptance: Acceptance[] = [
      AcceptanceSchema.parse({ type: 'symbol', symbol: 'class MainActivity' }),
    ];
    const changes = [{ path: join(root, 'ai/mobile/MainActivity.kt'), change: 'create' as const }];

    const l3 = await runLadder({
      expected: { path: expectedPath, kind: 'dir' },
      changes,
      acceptance,
      root,
      glossary: loadDefaultGlossary(),
    });
    expect(l3).toMatchObject({ level: 3, verdict: 'relocated', escalate: true });

    const f = fakeChain([YES, YES, YES]);
    const r = await runLadderL4(l3, {
      judge: f.chain,
      itemTitle: '모바일 앱',
      onAccept: learnL4Alias({ artifactId: 'art.mobile-app', manifest, glossaryFile }),
    });
    expect(r).toMatchObject({ level: 4, decision: 'accept', verdict: 'equal' });
    expect(manifest.resolve('art.mobile-app').aliases).toEqual(['ai/mobile']);
    const g = loadGlossary(glossaryFile);
    expect(g.terms.find((t) => t.canonical === 'harness')?.aliases).toContain('ai');

    // 다음 판정: 별칭 사전(L2)에서 끝난다 — 판정기 호출 없음
    const calls = f.backend.calls;
    const again = await runLadder({
      expected: { path: expectedPath, kind: 'dir' },
      changes,
      acceptance,
      root,
      glossary: g,
    });
    expect(again).toMatchObject({ level: 2, verdict: 'equal', actualPath: 'ai/mobile', escalate: false });
    expect(f.backend.calls).toBe(calls);
    const viaManifest = await runLadder({
      expected: {
        path: expectedPath,
        kind: 'dir',
        aliases: manifest.resolve('art.mobile-app').aliases ?? [],
      },
      changes,
      acceptance,
      root,
      glossary: loadDefaultGlossary(),
    });
    expect(viaManifest).toMatchObject({ level: 2, verdict: 'equal' });
  });
});
