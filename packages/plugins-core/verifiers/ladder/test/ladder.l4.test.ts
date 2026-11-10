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
import {
  parseJudgeAnswer,
  type DeviationKind,
  type JudgeAnswerFor,
  type JudgeQuestion,
  type JudgeState,
  type Verifier,
} from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { runLadder, type LadderResult } from '../src/ladder.js';
import { decideL4, learnL4Alias, resolveThresholds, runLadderL4, type L4Result } from '../src/l4.js';
import { toEvidence } from '../src/record.js';

/** 고정 답 판정기 — 보낸 질문·상태를 기록한다 */
export function fakeVerifier(p: number, kind: DeviationKind, id = 'fake') {
  const calls: { q: JudgeQuestion; s: JudgeState }[] = [];
  const v: Verifier = {
    id,
    async judge<Q extends JudgeQuestion>(q: Q, s: JudgeState): Promise<JudgeAnswerFor<Q>> {
      calls.push({ q, s });
      return parseJudgeAnswer(
        q,
        q.kind === 'noul' ? { noul: p, confidence: 0.9 } : { choice: kind, confidence: 0.8 },
      );
    },
  };
  return { v, calls };
}

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

const l4 = async (p: number, kind: DeviationKind, thresholds?: { accept?: number; fail?: number }) =>
  (await runLadderL4(prev, {
    verifier: fakeVerifier(p, kind).v,
    itemTitle: '모바일 앱',
    ...(thresholds ? { thresholds } : {}),
  })) as L4Result;

describe('26.5 L4 임계값: ≥0.9 인정, 0.6~0.9 L5, <0.6 실패 (설정 가능)', () => {
  it('경계값 (기본 임계값)', async () => {
    expect((await l4(0.9, 'equivalent')).decision).toBe('accept');
    expect((await l4(1, 'relocated-ok')).decision).toBe('accept');
    expect((await l4(0.8999, 'equivalent')).decision).toBe('escalate');
    expect((await l4(0.6, 'equivalent')).decision).toBe('escalate');
    expect((await l4(0.5999, 'equivalent')).decision).toBe('fail');
    expect((await l4(0, 'missing')).decision).toBe('fail');
  });

  it('결과: 인정 → equal/relocated(escalate false), L5 → escalate, 실패 → wrong/missing', async () => {
    expect(await l4(0.95, 'equivalent')).toMatchObject({ level: 4, verdict: 'equal', escalate: false });
    expect(await l4(0.95, 'relocated-ok')).toMatchObject({ verdict: 'relocated', escalate: false });
    expect(await l4(0.7, 'equivalent')).toMatchObject({ level: 4, verdict: 'relocated', escalate: true });
    expect(await l4(0.3, 'wrong-target')).toMatchObject({
      verdict: 'wrong',
      escalate: false,
      confidence: 0.7,
    });
    expect(await l4(0.3, 'missing')).toMatchObject({ verdict: 'missing', escalate: false });
    // p는 높은데 종류가 잘못된 대상 → 모순이므로 L5
    expect(await l4(0.95, 'wrong-target')).toMatchObject({ decision: 'escalate', escalate: true });
  });

  it('임계값 설정', async () => {
    const t = { accept: 0.8, fail: 0.5 };
    expect((await l4(0.8, 'equivalent', t)).decision).toBe('accept');
    expect((await l4(0.7999, 'equivalent', t)).decision).toBe('escalate');
    expect((await l4(0.5, 'equivalent', t)).decision).toBe('escalate');
    expect((await l4(0.4999, 'equivalent', t)).decision).toBe('fail');
    expect(decideL4(0.95, 'equivalent', { accept: 0.99 })).toBe('escalate');
    expect(() => resolveThresholds({ accept: 0.5, fail: 0.7 })).toThrow(RangeError);
    expect(resolveThresholds()).toEqual({ accept: 0.9, fail: 0.6 });
  });

  it('L3에서 확정된 결과(escalate=false)는 L4를 건너뜀, 판정기 오류는 L5', async () => {
    const done: LadderResult = { ...prev, level: 2, verdict: 'equal', escalate: false };
    const f = fakeVerifier(1, 'equivalent');
    expect(await runLadderL4(done, { verifier: f.v, itemTitle: 't' })).toBe(done);
    expect(f.calls).toHaveLength(0);
    const broken: Verifier = {
      id: 'broken',
      judge: () => Promise.reject(new Error('timeout')),
    };
    expect(await runLadderL4(prev, { verifier: broken, itemTitle: 't' })).toMatchObject({
      level: 4,
      decision: 'skipped',
      escalate: true,
    });
  });

  it('질문 2개 + 메타데이터 상태, evidence 기록', async () => {
    const f = fakeVerifier(0.95, 'equivalent');
    const r = await runLadderL4(prev, {
      verifier: f.v,
      itemTitle: '모바일 앱',
      acceptance: [AcceptanceSchema.parse({ type: 'symbol', symbol: 'MainActivity' })],
    });
    expect(f.calls.map((c) => c.q.id)).toEqual(['same_artifact', 'deviation_kind']);
    expect(f.calls[0]!.s).toEqual({
      itemTitle: '모바일 앱',
      expectedPath: 'harness/mobile',
      actualPath: 'ai/mobile',
      candidates: ['ai/mobile'],
      fileNames: ['mobile'],
      symbols: ['MainActivity'],
    });
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

  it('하네스/모바일 vs ai/mobile: L3 relocated → L4 인정 → manifest·glossary 별칭 → 재판정 L2', async () => {
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

    const r = await runLadderL4(l3, {
      verifier: fakeVerifier(0.93, 'equivalent').v,
      itemTitle: '모바일 앱',
      acceptance,
      onAccept: learnL4Alias({ artifactId: 'art.mobile-app', manifest, glossaryFile }),
    });
    expect(r).toMatchObject({ level: 4, decision: 'accept', verdict: 'equal' });
    expect(manifest.resolve('art.mobile-app').aliases).toEqual(['ai/mobile']);
    const g = loadGlossary(glossaryFile);
    expect(g.terms.find((t) => t.canonical === 'harness')?.aliases).toContain('ai');

    // 다음 판정: 별칭 사전(L2)에서 끝난다 — 판정기 호출 없음
    const again = await runLadder({
      expected: { path: expectedPath, kind: 'dir' },
      changes,
      acceptance,
      root,
      glossary: g,
    });
    expect(again).toMatchObject({ level: 2, verdict: 'equal', actualPath: 'ai/mobile', escalate: false });
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
