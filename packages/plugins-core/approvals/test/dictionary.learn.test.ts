import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DifferenceKind } from '../src/card.js';
import { dictionaryMatch, type DictionaryFiles } from '../src/dictionary.js';
import { createLedgerHandler } from '../src/handlers.js';
import { createApprovalStore, type ApprovalStore } from '../src/store.js';
import { buildCard } from '../src/templates.js';
import { sessionFixture, tempDir } from './helpers.js';

/**
 * 판정 체인 축소판: 자동 정리 → 사전 → 의미 판단 AI → 승인 카드.
 * F.3 검증: 사람이 "같은 걸로 인정 + 다음부터 자동"을 고른 뒤 같은 쌍을 다시 판정하면 사전에서 끝난다.
 */
function judge(
  input: { kind: DifferenceKind; expected: string; actual: string; itemId: string },
  deps: { dictionary: DictionaryFiles; ai: () => number; store: ApprovalStore },
): { stage: 'normalize' | 'dictionary' | 'ai' | 'card'; cardId?: string } {
  if (input.expected.trim() === input.actual.trim()) return { stage: 'normalize' };
  if (dictionaryMatch(deps.dictionary, input)) return { stage: 'dictionary' };
  const p = deps.ai();
  if (p >= 0.9) return { stage: 'ai' };
  const { card } = deps.store.add(buildCard({ ...input, confidence: p }));
  return { stage: 'card', cardId: card.id };
}

describe('F.3 승인 카드 "같은 걸로 인정" + "다음부터 자동" → 사전 저장', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => (t = tempDir()));
  afterEach(() => t.cleanup());

  const setup = () => {
    const fx = sessionFixture(t.dir);
    const dictionary = {
      glossaryFile: join(t.dir, 'glossary.json'),
      equivalencesFile: join(t.dir, 'equivalences.json'),
    };
    const store = createApprovalStore({
      dir: t.dir,
      sessionId: 's1',
      remindDelaysMs: [],
      handler: createLedgerHandler({ ledger: fx.ledger, manifest: fx.manifest, dictionary }),
    });
    let calls = 0;
    const ai = () => (calls++, 0.75);
    return { ...fx, dictionary, store, ai, calls: () => calls };
  };

  it.each([
    ['path', '하네스/모바일', 'ai/mobile', 'glossary'],
    ['text', '로그인 성공', '로그인에 성공했습니다', 'equivalences'],
    ['number', '1,000', '1000.0', 'equivalences'],
  ] as const)('%s: 같은 쌍 재판정이 사전(%s)에서 종료, AI 호출 없음', (kind, expected, actual, source) => {
    const s = setup();
    const input = { kind, expected, actual, itemId: '1' };
    const first = judge(input, s);
    expect(first.stage).toBe('card');
    expect(s.calls()).toBe(1);
    s.store.resolve(first.cardId!, 'accept', { remember: true });

    const again = judge({ ...input, itemId: '3' }, s);
    expect(again).toEqual({ stage: 'dictionary' });
    expect(s.calls()).toBe(1);
    expect(dictionaryMatch(s.dictionary, input)).toEqual({ source });
    // 순서를 바꿔도 같은 쌍
    expect(dictionaryMatch(s.dictionary, { kind, expected: actual, actual: expected })).not.toBeNull();
    if (source === 'equivalences') {
      const eq = JSON.parse(readFileSync(s.dictionary.equivalencesFile, 'utf8')) as {
        pairs: { kind: string; a: string; b: string }[];
      };
      expect(eq.pairs).toMatchObject([{ kind, a: expected, b: actual }]);
    }
  });

  it('"다음부터 자동"을 고르지 않으면 다음에도 다시 묻는다', () => {
    const s = setup();
    const input = { kind: 'text' as const, expected: '저장 완료', actual: '저장됨', itemId: '1' };
    s.store.resolve(judge(input, s).cardId!, 'accept', { remember: false });
    expect(judge({ ...input, itemId: '3' }, s).stage).toBe('card');
    expect(s.calls()).toBe(2);
  });
});
