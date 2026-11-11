import { describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import { Designer } from '../src/designer/designer.js';
import { findUnknownRefs } from '../src/designer/assets.js';
import { chatFixtures, designerInventory, replayAsk } from './designer-helpers.js';

/**
 * P4-G.1 fixtures/builder-chat/: 요청 10종(명확 5, 모호 3, 없는 기능 요구 2)과 기대 초안 구조.
 * 모킹 설계 엔진(리플레이)으로 전부 통과해야 한다.
 */
const fixtures = chatFixtures();

describe('P4-G.1 대화로 만들기 픽스처 10종 (모킹 설계 엔진)', () => {
  it('명확 5 · 모호 3 · 없는 기능 2', () => {
    const count = (c: string) => fixtures.filter((f) => f.category === c).length;
    expect([fixtures.length, count('clear'), count('ambiguous'), count('missing')]).toEqual([10, 5, 3, 2]);
  });

  for (const f of fixtures) {
    it(`${f.id} (${f.category}): ${f.request}`, async () => {
      const inv = designerInventory();
      const r = replayAsk(f.replies);
      const d = new Designer({ ask: r.ask, inventory: () => inv });
      let res = await d.design(f.request);
      if (f.expect.kind === 'questions') {
        expect(res.kind).toBe('questions');
        if (res.kind !== 'questions') return;
        expect(res.questions.length).toBeLessThanOrEqual(f.expect.maxQuestions!);
        for (const q of res.questions) expect(checkPlainKorean(q.text).ok, q.text).toBe(true);
        res = await d.design(f.request, { answers: f.answers! });
        expect(res.kind).toBe('draft');
        if (res.kind !== 'draft') return;
        expect(res.draft.nodes.map((n) => n.id)).toEqual(f.expect.afterAnswers!.nodes);
        return;
      }
      expect(res.kind).toBe('draft');
      if (res.kind !== 'draft') return;
      const draft = res.draft;
      expect(draft.nodes.map((n) => n.id)).toEqual(f.expect.nodes);
      // 있는 자산만 (가짜 id 0개)
      expect(findUnknownRefs(draft, inv)).toEqual([]);
      for (const [id, e] of Object.entries(f.expect.engines ?? {}))
        expect(draft.nodes.find((n) => n.id === id)!.engine).toBe(e);
      for (const [id, p] of Object.entries(f.expect.permissions ?? {}))
        expect(draft.nodes.find((n) => n.id === id)!.permission).toBe(p);
      if (f.expect.criticDiffers) {
        const writers = draft.nodes.filter((n) => n.duty === 'write').map((n) => n.engine);
        for (const c of draft.nodes.filter((n) => n.duty === 'check'))
          expect(writers).not.toContain(c.engine);
      }
      if (f.expect.gaps !== undefined) expect(draft.gaps).toHaveLength(f.expect.gaps);
      if (f.expect.gapsMin !== undefined) expect(draft.gaps.length).toBeGreaterThanOrEqual(f.expect.gapsMin);
      for (const fake of f.expect.fakeIds ?? []) {
        expect(JSON.stringify(draft.nodes)).not.toContain(fake);
        expect(draft.gaps.map((g) => g.missingId)).toContain(fake);
      }
      // 사용자에게 보이는 글은 모두 쉬운 말
      for (const line of draft.summary.split('\n')) expect(checkPlainKorean(line).ok, line).toBe(true);
      for (const n of draft.nodes) expect(checkPlainKorean(n.reason).ok, n.reason).toBe(true);
      for (const g of draft.gaps) expect(checkPlainKorean(g.need, { label: true }).ok, g.need).toBe(true);
      for (const n of res.notices) expect(checkPlainKorean(n.message).ok, n.message).toBe(true);
    });
  }
});
