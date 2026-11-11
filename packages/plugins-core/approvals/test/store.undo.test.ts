import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dictionaryMatch } from '../src/dictionary.js';
import { createLedgerHandler } from '../src/handlers.js';
import { createApprovalStore } from '../src/store.js';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT, sessionFixture, tempDir } from './helpers.js';

describe('H.23 같은 세션 안에서 "방금 선택 취소" (사전 저장도 취소)', () => {
  let t: ReturnType<typeof tempDir>;
  beforeEach(() => (t = tempDir()));
  afterEach(() => t.cleanup());

  const setup = () => {
    const fx = sessionFixture(t.dir);
    const dictionary = {
      glossaryFile: join(t.dir, 'glossary.json'),
      equivalencesFile: join(t.dir, 'equivalences.json'),
    };
    const events: { type: string; undone?: boolean }[] = [];
    const store = createApprovalStore({
      dir: t.dir,
      sessionId: 's1',
      remindDelaysMs: [],
      log: { append: (e: never) => events.push(e) },
      handler: createLedgerHandler({ ledger: fx.ledger, manifest: fx.manifest, dictionary }),
    });
    return { ...fx, dictionary, store, events };
  };

  it('인정 + 다음부터 자동 → 취소: 항목 상태·사전·카드 원복', () => {
    const { ledger, store, dictionary, events } = setup();
    const before = ledger.item('1');
    const card = store.add(buildCard({ ...PATH_INPUT, itemId: '1' })).card;
    store.resolve(card.id, 'accept', { remember: true });
    expect(ledger.item('1').status).toBe('done');
    expect(existsSync(dictionary.glossaryFile)).toBe(true);
    expect(store.lastUndoable()).toEqual({ cardId: card.id, choice: 'accept' });

    const back = store.undo();
    expect(back.id).toBe(card.id);
    expect(ledger.item('1')).toEqual(before);
    expect(existsSync(dictionary.glossaryFile)).toBe(false);
    expect(
      dictionaryMatch(dictionary, { kind: 'path', expected: '하네스/모바일', actual: 'ai/mobile' }),
    ).toBeNull();
    expect(store.get(card.id).status).toBe('pending');
    expect(store.records().map((r) => r.type)).toEqual(['decision', 'undo']);
    expect(events.map((e) => `${e.type}${e.undone ? ':undone' : ''}`)).toEqual([
      'approval_request',
      'approval_resolved',
      'approval_resolved:undone',
      'approval_request',
    ]);
    // 다시 결정할 수 있다
    store.resolve(card.id, 'stop');
    expect(ledger.item('1').status).toBe('blocked');
  });

  it('텍스트 사전(equivalences.json)에 이미 있던 쌍은 지우지 않고 방금 추가한 것만 취소', () => {
    const { store, dictionary } = setup();
    const a = store.add(
      buildCard({ kind: 'text', itemId: '1', expected: '확인', actual: '확인됨', id: 'a' }),
    ).card;
    store.resolve(a.id, 'accept', { remember: true });
    const b = store.add(
      buildCard({ kind: 'text', itemId: '3', expected: '완료', actual: '끝', id: 'b' }),
    ).card;
    store.resolve(b.id, 'accept', { remember: true });
    store.undo();
    const eq = JSON.parse(readFileSync(dictionary.equivalencesFile, 'utf8')) as { pairs: { a: string }[] };
    expect(eq.pairs.map((p) => p.a)).toEqual(['확인']);
  });

  it('이동 허락 취소 → manifest 경로도 원래대로', () => {
    const { store, manifest, ledger } = setup();
    const card = store.add(
      buildCard({ ...PATH_INPUT, itemId: '1', expected: 'harness/mobile', actual: 'ai/mobile' }),
    ).card;
    store.resolve(card.id, 'allow-move');
    expect(manifest.read()?.artifacts['art.mobile-app']?.path).toBe('ai/mobile');
    store.undo();
    expect(manifest.read()?.artifacts['art.mobile-app']?.path).toBe('harness/mobile');
    expect(ledger.item('2').acceptance[0]).toMatchObject({ run: 'pnpm test harness/mobile/login' });
    expect(ledger.item('1').status).toBe('verifying');
  });

  it('다른 세션(새 저장소 인스턴스)에서는 취소할 것이 없다', () => {
    const { store, ledger, manifest } = setup();
    const card = store.add(buildCard({ ...PATH_INPUT, itemId: '1' })).card;
    store.resolve(card.id, 'stop');
    const other = createApprovalStore({
      dir: t.dir,
      remindDelaysMs: [],
      handler: createLedgerHandler({ ledger, manifest }),
    });
    expect(() => other.undo()).toThrow(/취소할 선택이 없습니다/);
  });
});
