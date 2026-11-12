// @features F-025
import { createJudgeChain } from '@harness-x/judge';
import { describe, expect, it } from 'vitest';
import type { LadderResult } from '../src/ladder.js';
import { runLadderL4, selectL4Judge } from '../src/l4.js';
import { judgeSettingsFrom } from '../src/settings.js';

const prev: LadderResult = {
  level: 3,
  verdict: 'relocated',
  confidence: 0.8,
  reason: '위치만 다름',
  expectedPath: 'harness/mobile',
  actualPath: 'ai/mobile',
  candidates: [],
  escalate: true,
};

/** 로컬 Ollama 흉내 (fetch 주입 — 실제 네트워크 없음). 판정 질문마다 '예' */
function ollamaChain() {
  const urls: string[] = [];
  const fetchFake = (async (url: string) => {
    urls.push(url);
    if (url.endsWith('/api/tags'))
      return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }));
    return new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            same_meaning: 'yes',
            difference_kind: 'equivalent',
            plain_reason: '같은 폴더예요.',
          }),
        },
      }),
    );
  }) as unknown as typeof fetch;
  const chain = createJudgeChain({}, { listEngines: () => [], fetch: fetchFake });
  return { chain, urls };
}

describe('판정기 선택 (J.4: verifier.l4 폐기 → judge.*, E.14: L4 = judge 체인)', () => {
  it('judge.semantic = off → 체인 호출 없이 L5로 직행', async () => {
    const { chain, urls } = ollamaChain();
    const j = selectL4Judge(judgeSettingsFrom({ judge: { semantic: 'off' } }), chain);
    expect(j).toBeNull();
    const r = await runLadderL4(prev, { judge: j, itemTitle: '모바일 앱' });
    expect(r).toMatchObject({ level: 4, decision: 'skipped', escalate: true, verdict: 'relocated' });
    expect(r.reason).toMatch(/off → L5/);
    expect(urls).toEqual([]);
  });

  it('judge.semantic = on(기본) → 체인(② 로컬 Ollama)이 판정', async () => {
    const { chain, urls } = ollamaChain();
    const j = selectL4Judge(judgeSettingsFrom({}), chain);
    expect(j).toBe(chain);
    const r = await runLadderL4(prev, { judge: j, itemTitle: '모바일 앱' });
    expect(r).toMatchObject({
      level: 4,
      decision: 'accept',
      verdict: 'equal',
      escalate: false,
      verifierId: 'ollama',
    });
    expect(urls.filter((u) => u.endsWith('/api/chat'))).toHaveLength(3);
  });

  it('체인이 없으면 null (L5로)', () => {
    expect(selectL4Judge(judgeSettingsFrom({}), undefined)).toBeNull();
  });
});
