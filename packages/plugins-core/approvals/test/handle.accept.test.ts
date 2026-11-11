import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dictionaryMatch } from '../src/dictionary.js';
import { createLedgerHandler } from '../src/handlers.js';
import { createApprovalStore } from '../src/store.js';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT, sessionFixture, tempDir } from './helpers.js';

describe('H.18 "같은 걸로 인정" → 항목 done + level: human, "다음부터 자동"이면 F.3', () => {
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
    return { ...fx, dictionary, store };
  };

  it('상태 done + verdict L5 + evidence level human, 사전은 그대로', () => {
    const { ledger, store, dictionary } = setup();
    const card = store.add(buildCard({ ...PATH_INPUT, itemId: '1' })).card;
    const r = store.resolve(card.id, 'accept', { remember: false });
    const it1 = ledger.item('1');
    expect(it1.status).toBe('done');
    expect(it1.verdict).toMatchObject({ level: 5, verdict: 'equal', confidence: 1 });
    expect(it1.evidence.at(-1)).toMatchObject({
      kind: 'approval_card',
      level: 'human',
      choice: 'accept',
      remember: false,
      cardId: card.id,
    });
    expect(r.outcome).toMatchObject({ status: 'done', level: 'human' });
    expect(existsSync(dictionary.glossaryFile)).toBe(false);
    expect(existsSync(dictionary.equivalencesFile)).toBe(false);
  });

  it('"다음부터 자동": 경로 → glossary 별칭 (ai ⇒ harness)', () => {
    const { ledger, store, dictionary } = setup();
    const card = store.add(buildCard({ ...PATH_INPUT, itemId: '1' })).card;
    expect(
      dictionaryMatch(dictionary, { kind: 'path', expected: '하네스/모바일', actual: 'ai/mobile' }),
    ).toBeNull();
    const r = store.resolve(card.id, 'accept', { remember: true });
    expect(ledger.item('1').status).toBe('done');
    expect(r.outcome.dictionary).toEqual({
      target: 'glossary',
      glossaryAliases: [{ canonical: 'harness', alias: 'ai' }],
      added: false,
    });
    const g = JSON.parse(readFileSync(dictionary.glossaryFile, 'utf8')) as {
      terms: { canonical: string; aliases: string[] }[];
    };
    expect(g.terms.find((x) => x.canonical === 'harness')?.aliases).toContain('ai');
    expect(
      dictionaryMatch(dictionary, { kind: 'path', expected: '하네스/모바일', actual: 'ai/mobile' }),
    ).toEqual({
      source: 'glossary',
    });
  });
});
