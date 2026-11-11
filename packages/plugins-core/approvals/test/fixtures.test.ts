import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApprovalCardSchema, CHOICE_LABELS, DIFFERENCE_KINDS } from '../src/card.js';
import { checkPlainKorean } from '../src/plain-korean.js';

const DIR = fileURLToPath(new URL('../../../../fixtures/approvals/', import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const cards = files.map((f) => ({
  file: f,
  card: ApprovalCardSchema.parse(JSON.parse(readFileSync(DIR + f, 'utf8'))),
}));

describe('H.9 fixtures/approvals — 카드 10장 (종류 5 × 2)', () => {
  it('10장, 종류마다 2장', () => {
    expect(cards).toHaveLength(10);
    for (const k of DIFFERENCE_KINDS) expect(cards.filter((c) => c.card.kind === k)).toHaveLength(2);
  });

  it.each(files)('%s: 화면 문구 전부 쉬운 말 검사 통과', (file) => {
    const { card } = cards.find((c) => c.file === file)!;
    const sentences = [
      card.whatHappened,
      card.whyAsking,
      ...(card.recommendationReason ? [card.recommendationReason] : []),
    ];
    for (const t of sentences) expect(checkPlainKorean(t), t).toEqual({ ok: true, violations: [] });
    for (const t of [card.title, card.confidenceWord, ...card.options.map((o) => o.label)])
      expect(checkPlainKorean(t, { label: true }), t).toEqual({ ok: true, violations: [] });
    for (const o of card.options) expect(o.label).toBe(CHOICE_LABELS[o.id]);
  });
});
