import { LocalVerifier } from '@harness-x/verifier-local';
import { describe, expect, it } from 'vitest';
import type { LadderResult } from '../src/ladder.js';
import { l4ModeFrom, runLadderL4, selectL4Verifier, type L4VerifierFactories } from '../src/l4.js';

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

describe('26.7 판정기 선택: verifier.l4 = local | off', () => {
  it('설정 읽기', () => {
    expect(l4ModeFrom({})).toBe('off');
    expect(l4ModeFrom({ 'verifier.l4': 'local' })).toBe('local');
    expect(() => l4ModeFrom({ verifier: { l4: 'gpt' } })).toThrow(RangeError);
    // 삭제된 외부 판정기 모드는 더 이상 받지 않는다
    expect(() => l4ModeFrom({ verifier: { l4: 'remote' } })).toThrow(/local \| off/);
  });

  it('off → 판정기 호출 없이 L5로 직행', async () => {
    const { fx, urls, made } = factories();
    const v = selectL4Verifier(l4ModeFrom({ verifier: { l4: 'off' } }), fx);
    expect(v).toBeNull();
    const r = await runLadderL4(prev, { verifier: v, itemTitle: '모바일 앱' });
    expect(r).toMatchObject({ level: 4, decision: 'skipped', escalate: true, verdict: 'relocated' });
    expect(r.reason).toMatch(/off → L5/);
    expect(made).toEqual([]);
    expect(urls).toEqual([]);
  });

  it('local → 로컬 판정기만 만들어 질문 2개를 보낸다', async () => {
    for (const mode of ['local'] as const) {
      const { fx, urls, made } = factories();
      const v = selectL4Verifier(l4ModeFrom({ verifier: { l4: mode } }), fx);
      expect(v?.id).toBe(mode);
      expect(made).toEqual([mode]);
      const r = await runLadderL4(prev, { verifier: v, itemTitle: '모바일 앱' });
      expect(r).toMatchObject({ level: 4, decision: 'accept', verdict: 'equal', escalate: false });
      expect(urls).toEqual(['http://127.0.0.1:11434/api/chat', 'http://127.0.0.1:11434/api/chat']);
    }
  });

  it('선택된 판정기 플러그인이 없으면 오류', () => {
    expect(() => selectL4Verifier('local', {})).toThrow(/verifier-local/);
  });
});
