import { describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import { Designer } from '../src/designer/designer.js';
import { chatFixtures, designerInventory, replayAsk } from './designer-helpers.js';

const ambiguous = chatFixtures().filter((f) => f.category === 'ambiguous');

describe('P4-C.3 되묻기: 모호한 요청 → 질문 ≤3 (선택지 버튼, 쉬운 말), "알아서 해 줘" = 질문 생략', () => {
  it('모호한 요청 픽스처 3종', () => expect(ambiguous).toHaveLength(3));

  for (const f of ambiguous) {
    it(`${f.id}: 질문 ≤3 · 선택지 2개 이상 · 쉬운 말 검사 통과`, async () => {
      const r = replayAsk(f.replies);
      const d = new Designer({ ask: r.ask, inventory: () => designerInventory() });
      const res = await d.design(f.request);
      expect(res.kind).toBe('questions');
      if (res.kind !== 'questions') return;
      expect(res.questions.length).toBeGreaterThan(0);
      expect(res.questions.length).toBeLessThanOrEqual(3);
      for (const q of res.questions) {
        expect(q.choices.length).toBeGreaterThanOrEqual(2);
        expect(checkPlainKorean(q.text).ok, q.text).toBe(true);
        for (const c of q.choices) expect(checkPlainKorean(c, { label: true }).ok, c).toBe(true);
      }
      // 프롬프트에 질문 상한이 들어간다
      expect(r.prompts[0]!.user).toContain('at most 3 questions');
    });

    it(`${f.id}: 답을 고르면 질문 없이 초안`, async () => {
      const r = replayAsk(f.replies);
      const d = new Designer({ ask: r.ask, inventory: () => designerInventory() });
      await d.design(f.request);
      const res = await d.design(f.request, { answers: f.answers! });
      expect(res.kind).toBe('draft');
      expect(r.prompts[1]!.user).toContain(f.answers![0]!.answer);
    });
  }

  it('"알아서 해 줘" → 질문하지 말라고 하고 바로 초안 (질문을 돌려줘도 질문 0개)', async () => {
    const f = ambiguous[0]!;
    const r = replayAsk([f.replies[0]!, f.replies[1]!]);
    const d = new Designer({ ask: r.ask, inventory: () => designerInventory() });
    const res = await d.design(f.request, { skipQuestions: true });
    expect(r.prompts[0]!.user).toContain('Do not ask questions');
    expect(res.kind).toBe('draft');
  });

  it('builder.maxQuestions 설정을 따른다 (1이면 질문 1개)', async () => {
    const f = ambiguous[0]!;
    const d = new Designer({
      ask: replayAsk(f.replies).ask,
      inventory: () => designerInventory(),
      settings: { maxQuestions: 1 },
    });
    const res = await d.design(f.request);
    expect(res.kind === 'questions' && res.questions.length).toBe(1);
  });

  it('어려운 말 질문은 빼고, 남는 질문이 없으면 바로 초안', async () => {
    const f = ambiguous[0]!;
    const hard = { questions: [{ id: 'q1', text: 'JSON schema를 어떻게 parse할까', choices: ['A', 'B'] }] };
    const r = replayAsk([hard, f.replies[1]!]);
    const res = await new Designer({ ask: r.ask, inventory: () => designerInventory() }).design(f.request);
    expect(res.kind).toBe('draft');
  });
});
