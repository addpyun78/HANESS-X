import { existsSync, readFileSync } from 'node:fs';
import { checkPlainKorean } from '@harness-x/approvals';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConversionQueue,
  DEFAULT_CONVERTERS,
  MESSAGES,
  SECRET_CHOICE_LABELS,
  applySecretChoice,
  maskSecretText,
  scanSecrets,
  type SecretCard,
} from '../src/index.js';
import { makeStore, tempProject } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const ENV =
  'DB_HOST=localhost\nDB_PASSWORD=hunter2-very-secret\nexport OPENAI_KEY="sk-abcdefghijklmnopqrstuv123"\n';
const NOTE = '설정 메모\napi_token: tok_live_9f8e7d6c5b4a\n그 외 내용\n';

async function setup(name: string, body: string) {
  const p = tempProject();
  cleanups.push(p.cleanup);
  const store = makeStore(p.root);
  const cards: SecretCard[] = [];
  const q = new ConversionQueue({ store, converters: DEFAULT_CONVERTERS, onSecret: (c) => cards.push(c) });
  const { attachment } = await store.add('s', { name, data: Buffer.from(body) });
  const a = await q.enqueue(attachment);
  return { store, a, cards };
}

describe('1C.2 비밀 검사: .env·키 패턴이면 카드 [가리고 보내기(추천)] [그대로 보내기] [빼기]', () => {
  it('.env 파일과 키 패턴을 찾고, 카드에는 위치만(값 없음)', async () => {
    expect(scanSecrets(NOTE).map((f) => f.line)).toEqual([2]);
    expect(scanSecrets('그냥 글이에요').length).toBe(0);
    const { a, cards } = await setup('.env', ENV);
    expect(a.warnings.map((w) => w.message)).toContain(MESSAGES.secretFound);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.title).toBe('비밀번호나 키가 들어 있어요.');
    expect(card.choices).toEqual([
      { id: 'mask', label: '가리고 보내기(추천)', recommended: true },
      { id: 'send', label: '그대로 보내기', recommended: false },
      { id: 'remove', label: '빼기', recommended: false },
    ]);
    expect(JSON.stringify(card)).not.toContain('hunter2');
    for (const t of [MESSAGES.secretFound, MESSAGES.secretMasked, MESSAGES.secretSentAsIs])
      expect(checkPlainKorean(t).ok, t).toBe(true);
    for (const l of Object.values(SECRET_CHOICE_LABELS))
      expect(checkPlainKorean(l, { label: true }).ok).toBe(true);
  });

  it('선택 1 가리고 보내기: 가린 글(masked-text)을 만든다 — 전달 선택기는 이것을 먼저 쓴다(1D.2)', async () => {
    const { store, a } = await setup('.env', ENV);
    const masked = applySecretChoice(store, a, 'mask')!;
    const rep = masked.representations.find((r) => r.form === 'masked-text')!;
    const text = readFileSync(rep.path, 'utf8');
    expect(text).toBe('DB_HOST=••••••\nDB_PASSWORD=••••••\nexport OPENAI_KEY=••••••\n');
    expect(masked.warnings.map((w) => w.message)).toEqual([MESSAGES.secretMasked]);
    expect(store.get('s', a.id)!.representations.some((r) => r.form === 'masked-text')).toBe(true);
    expect(maskSecretText(NOTE)).toBe('설정 메모\napi_token: ••••••\n그 외 내용\n');
  });

  it('선택 2 그대로 보내기: 글 그대로 + 안내', async () => {
    const { store, a } = await setup('메모.txt', NOTE);
    const sent = applySecretChoice(store, a, 'send')!;
    expect(sent.representations.some((r) => r.form === 'masked-text')).toBe(false);
    expect(sent.warnings.map((w) => w.message)).toEqual([MESSAGES.secretSentAsIs]);
    const textRep = sent.representations.find((r) => r.form === 'text')!;
    expect(readFileSync(textRep.path, 'utf8')).toContain('tok_live_9f8e7d6c5b4a');
  });

  it('선택 3 빼기: 첨부가 사라진다', async () => {
    const { store, a } = await setup('.env', ENV);
    expect(applySecretChoice(store, a, 'remove')).toBeUndefined();
    expect(existsSync(a.storedPath)).toBe(false);
    expect(store.list('s')).toEqual([]);
  });
});
