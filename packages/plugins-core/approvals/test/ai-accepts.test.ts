import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAiAcceptTracker } from '../src/ai-accepts.js';
import { dictionaryMatch } from '../src/dictionary.js';
import { createLedgerHandler } from '../src/handlers.js';
import { checkPlainKorean } from '../src/plain-korean.js';
import { createApprovalStore } from '../src/store.js';
import { sessionFixture, tempDir } from './helpers.js';

describe('F.4 같은 쌍이 AI 판단으로 3회 인정 → 사전 등록을 카드로 제안 (자동 등록 금지)', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => (t = tempDir()));
  afterEach(() => t.cleanup());

  const setup = () => {
    const fx = sessionFixture(t.dir);
    const dictionary = {
      glossaryFile: join(t.dir, 'glossary.json'),
      equivalencesFile: join(t.dir, 'equivalences.json'),
    };
    const tracker = createAiAcceptTracker({ file: join(t.dir, 'ai-accepts.json'), dictionary });
    const store = createApprovalStore({
      dir: t.dir,
      sessionId: 's1',
      remindDelaysMs: [],
      handler: createLedgerHandler({ ledger: fx.ledger, manifest: fx.manifest, dictionary }),
    });
    return { dictionary, tracker, store };
  };
  const PAIR = {
    kind: 'text' as const,
    expected: '로그인 성공',
    actual: '로그인에 성공했습니다',
    itemId: '1',
  };

  it('1·2회째는 제안 없음, 3회째 제안 카드, 4회째는 다시 제안하지 않음', () => {
    const { tracker, dictionary } = setup();
    expect(tracker.record(PAIR)).toEqual({ count: 1 });
    expect(tracker.record({ ...PAIR, itemId: '2' })).toEqual({ count: 2 });
    const third = tracker.record({ ...PAIR, itemId: '3', judgeEngine: 'ollama:qwen3' });
    expect(third.count).toBe(3);
    expect(third.proposal).toMatchObject({
      kind: 'dictionary-proposal',
      itemId: '3',
      whatHappened: 'AI가 "로그인 성공"과 "로그인에 성공했습니다"를 세 번 같은 걸로 인정했어요.',
      whyAsking: '다음부터 묻지 않도록 사전에 넣을지 정해 주세요.',
      options: [
        { id: 'register', label: '네, 사전에 넣어 주세요' },
        { id: 'skip', label: '아니요, 넣지 않을게요' },
      ],
      technical: { expected: '로그인 성공', actual: '로그인에 성공했습니다', comparator: 'text' },
    });
    expect(checkPlainKorean(third.proposal!.whatHappened).ok).toBe(true);
    expect(checkPlainKorean(third.proposal!.whyAsking).ok).toBe(true);
    expect(tracker.record({ ...PAIR, itemId: '4' })).toEqual({ count: 4 });
    // 자동 등록 금지: 제안만 했을 뿐 사전은 비어 있다
    expect(existsSync(dictionary.equivalencesFile)).toBe(false);
    expect(dictionaryMatch(dictionary, PAIR)).toBeNull();
  });

  it('"네, 사전에 넣어 주세요"를 눌러야 등록, "아니요"면 등록 안 함', () => {
    const { tracker, store, dictionary } = setup();
    tracker.record(PAIR);
    tracker.record(PAIR);
    const yes = store.add(tracker.record(PAIR).proposal!).card;
    expect(dictionaryMatch(dictionary, PAIR)).toBeNull();
    store.resolve(yes.id, 'register');
    expect(dictionaryMatch(dictionary, PAIR)).toEqual({ source: 'equivalences' });

    const other = { ...PAIR, expected: '저장 완료', actual: '저장됨' };
    tracker.record(other);
    tracker.record(other);
    const no = store.add(tracker.record(other).proposal!).card;
    store.resolve(no.id, 'skip');
    expect(dictionaryMatch(dictionary, other)).toBeNull();
  });

  it('이미 사전에 있는 쌍은 제안하지 않는다', () => {
    const { tracker } = setup();
    const known = { kind: 'path' as const, expected: '하네스/모바일', actual: 'harness/mobile', itemId: '1' };
    for (let i = 0; i < 3; i++) expect(tracker.record(known).proposal).toBeUndefined();
  });
});
