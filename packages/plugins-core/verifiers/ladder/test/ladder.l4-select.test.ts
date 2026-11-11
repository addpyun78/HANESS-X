import { LocalVerifier } from '@harness-x/verifier-local';
import { describe, expect, it } from 'vitest';
import type { LadderResult } from '../src/ladder.js';
import { runLadderL4, selectL4Verifier, type L4VerifierFactories } from '../src/l4.js';
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

function factories() {
  const urls: string[] = [];
  const made: string[] = [];
  const f = (reply: (body: { messages?: unknown; format?: unknown }) => unknown) =>
    (async (url: string, init: RequestInit) => {
      urls.push(url);
      return new Response(JSON.stringify(reply(JSON.parse(String(init.body)))));
    }) as unknown as typeof fetch;
  // 질문 종류에 맞춰 답한다 (json_schema의 required[0] = noul | choice)
  const answer = (schema: { required: string[] }) =>
    schema.required[0] === 'noul'
      ? { noul: 0.95, confidence: 0.9 }
      : { choice: 'equivalent', confidence: 0.9 };
  const fx: L4VerifierFactories = {
    local: () => {
      made.push('local');
      return new LocalVerifier({
        fetch: f((b) => ({
          message: { content: JSON.stringify(answer(b.format as { required: string[] })) },
        })),
      });
    },
  };
  return { fx, urls, made };
}

describe('판정기 선택 (J.4: verifier.l4 폐기 → judge.*)', () => {
  it('judge.semantic = off → 판정기 호출 없이 L5로 직행', async () => {
    const { fx, urls, made } = factories();
    const v = selectL4Verifier(judgeSettingsFrom({ judge: { semantic: 'off' } }), fx);
    expect(v).toBeNull();
    const r = await runLadderL4(prev, { verifier: v, itemTitle: '모바일 앱' });
    expect(r).toMatchObject({ level: 4, decision: 'skipped', escalate: true, verdict: 'relocated' });
    expect(r.reason).toMatch(/off → L5/);
    expect(made).toEqual([]);
    expect(urls).toEqual([]);
  });

  it('judge.semantic = on(기본) → 로컬 판정기만 만들어 질문 2개를 보낸다', async () => {
    const { fx, urls, made } = factories();
    const v = selectL4Verifier(judgeSettingsFrom({}), fx);
    expect(v?.id).toBe('local');
    expect(made).toEqual(['local']);
    const r = await runLadderL4(prev, { verifier: v, itemTitle: '모바일 앱' });
    expect(r).toMatchObject({ level: 4, decision: 'accept', verdict: 'equal', escalate: false });
    expect(urls).toEqual(['http://127.0.0.1:11434/api/chat', 'http://127.0.0.1:11434/api/chat']);
  });

  it('로컬 판정기가 없으면 null (L5로)', () => {
    expect(selectL4Verifier(judgeSettingsFrom({}), {})).toBeNull();
  });
});
