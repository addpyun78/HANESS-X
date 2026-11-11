import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApprovalStore } from '@harness-x/approvals';
import { AcceptanceSchema, loadDefaultGlossary } from '@harness-x/checklist-ledger';
import { defaultCompareCtx } from '@harness-x/comparators';
import { afterEach, describe, expect, it } from 'vitest';
import { checkContentEvidence } from '../src/evidence.js';
import { runLadder } from '../src/ladder.js';
import { runLadderL4 } from '../src/l4.js';
import { createComparePipeline } from '../src/pipeline.js';
import { fakeChain, YES } from './judge-fakes.js';

/**
 * T-100 G.2 진짜 틀림 회귀: 판정 AI가 무조건 "같다"(3/3, 신뢰도 1.0)고 답하도록 오판을 주입해도
 * 200 vs 500, success vs error, 다른 폴더는 통과하지 않는다 — 코드 단계에서 different로 끝나 AI에 묻지 않는다.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'hx-g2-'));
  dirs.push(d);
  return d;
};

/** 오판 주입: 어떤 쌍이든 같다고 답하는 체인 + 승인 카드 저장소 */
function rig() {
  const dir = temp();
  const injected = fakeChain([YES, YES, YES]);
  const store = createApprovalStore({ dir, sessionId: 'g2', remindDelaysMs: [] });
  const pipeline = createComparePipeline({ judge: injected.chain, approvals: store, sessionId: 'g2' });
  const ctx = defaultCompareCtx({ workspaceRoot: dir, glossary: loadDefaultGlossary() });
  const compare = (kind: string, expected: unknown, actual: unknown) =>
    pipeline.compare({ kind, expected, actual, ctx, itemId: '1', itemTitle: '확인' });
  return { injected, store, pipeline, compare, dir };
}

describe('G.2 오판 주입(모킹)에도 진짜 틀림은 통과하지 않는다', () => {
  it('주입이 살아 있다: 정말 같은 뜻인 쌍은 AI 판단으로 통과 (대조군)', async () => {
    const r = rig();
    const ok = await r.compare('auto', '완료', '작업이 끝났습니다');
    expect(ok).toMatchObject({ status: 'pass', aiJudged: true, outcome: { level: 'semantic' } });
    expect(r.injected.backend.calls).toBe(3);
  });

  it.each([
    ['number', '200', '500'],
    ['auto', '200', '500'],
    ['text', 'HTTP 200', 'HTTP 500'],
    ['auto', 'status: 200 OK', 'status: 500 OK'],
    ['json', '{"status":200}', '{"status":500}'],
    ['exitCode', 0, 1],
  ])('%s %s vs %s → 실패, AI 호출 0', async (kind, e, a) => {
    const r = rig();
    const out = await r.compare(kind, e, a);
    expect(out).toMatchObject({ status: 'fail', aiJudged: false, outcome: { verdict: 'different' } });
    expect(r.injected.backend.calls).toBe(0);
    expect(r.store.pending()).toEqual([]);
  });

  it.each([
    ['auto', 'success', 'error'],
    ['text', 'Build succeeded', 'Build failed'],
    ['auto', '저장 완료', '저장 실패'],
    ['text', 'ok', 'Error: connection refused'],
    ['json', '{"result":"success"}', '{"result":"error"}'],
  ])('%s %s vs %s → 실패, AI 호출 0', async (kind, e, a) => {
    const r = rig();
    const out = await r.compare(kind, e, a);
    expect(out.status).toBe('fail');
    expect(out.outcome.verdict).toBe('different');
    expect(r.injected.backend.calls).toBe(0);
    expect(r.store.pending()).toEqual([]);
  });

  it('다른 폴더: harness/server vs harness/client(서버 vs 클라이언트) → 실패, AI 호출 0', async () => {
    const r = rig();
    for (const [e, a] of [
      ['harness/server', 'harness/client'],
      ['하네스/서버', 'harness/client'],
      ['src/web/app.ts', 'src/mobile/app.ts'],
    ] as const) {
      const out = await r.compare('path', e, a);
      expect(out, `${e} vs ${a}`).toMatchObject({ status: 'fail', outcome: { verdict: 'different' } });
    }
    expect(r.injected.backend.calls).toBe(0);
  });

  it('다른 폴더(사다리): 잘못된 대상 픽스처는 L3에서 wrong — 오판 주입 체인을 붙여도 L4가 바꾸지 않는다', async () => {
    const fx = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../fixtures/path-equivalence/11-wrong-target.json', import.meta.url)),
        'utf8',
      ),
    ) as {
      expected: { path: string; kind: 'file' | 'dir' };
      files: Record<string, string>;
      changes: { path: string; change: 'create' }[];
      acceptance: unknown[];
    };
    const root = temp();
    for (const [p, c] of Object.entries(fx.files)) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), c);
    }
    const injected = fakeChain([YES, YES, YES]);
    const l3 = await runLadder({
      expected: fx.expected,
      changes: fx.changes,
      acceptance: fx.acceptance.map((a) => AcceptanceSchema.parse(a)),
      root,
      glossary: loadDefaultGlossary(),
    });
    const r = await runLadderL4(l3, { judge: injected.chain, itemTitle: '모바일 앱' });
    expect(r).toMatchObject({ level: 3, verdict: 'wrong', escalate: false });
    expect(injected.backend.calls).toBe(0);
  });

  it('내용 증거 실행기: 명령 출력 기대 "success" · 실제 "error" → 실패 (의미 판단 단계를 붙여도)', async () => {
    const r = rig();
    const acc = AcceptanceSchema.parse({ type: 'command', run: 'echo error', expectOutput: 'success' });
    const ev = await checkContentEvidence([acc], {
      artifactPath: r.dir,
      root: r.dir,
      kind: 'dir',
      semantic: (o, raw) => r.pipeline.resolve(o, raw, { itemId: '1', itemTitle: '확인' }),
    });
    expect(ev).toMatchObject({ ok: false, awaiting: false });
    expect(ev.outcomes[0]!.compare).toMatchObject({ verdict: 'different' });
    expect(r.injected.backend.calls).toBe(0);
  });
});
