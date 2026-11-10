import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  JudgeAnswerError,
  JudgeStateSchema,
  judgeAnswerJsonSchema,
  parseJudgeAnswer,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type JudgeAnswerFor,
  type JudgeQuestion,
  type JudgeState,
  type NoulAnswer,
  type NoulQuestion,
  type ScoreAnswer,
  type ScoreQuestion,
  type Verifier,
} from '../src/index.js';

const noul: NoulQuestion = { kind: 'noul', id: 'q.noul', prompt: '같은가?' };
const choice: ChoiceQuestion = { kind: 'choice', id: 'q.choice', prompt: '무엇인가?', choices: ['a', 'b'] };
const score: ScoreQuestion = { kind: 'score', id: 'q.score', prompt: '얼마나?', min: 0, max: 10 };
const state: JudgeState = JudgeStateSchema.parse({ itemTitle: '모바일 앱', expectedPath: 'harness/mobile' });

/** 고정 답 판정기 (타입 검사용) */
const fake: Verifier = {
  id: 'fake',
  async judge<Q extends JudgeQuestion>(q: Q): Promise<JudgeAnswerFor<Q>> {
    const raw =
      q.kind === 'noul'
        ? { noul: 0.9, confidence: 0.8 }
        : q.kind === 'choice'
          ? { choice: 'a', confidence: 1 }
          : { score: 3, confidence: 0.5 };
    return parseJudgeAnswer(q, raw);
  },
};

describe('verifier 인터페이스 judge(question, state) → {noul|choice|score, confidence}', () => {
  it('질문 종류별 답 타입', async () => {
    expectTypeOf(fake.judge(noul, state)).resolves.toEqualTypeOf<NoulAnswer>();
    expectTypeOf(fake.judge(choice, state)).resolves.toEqualTypeOf<ChoiceAnswer>();
    expectTypeOf(fake.judge(score, state)).resolves.toEqualTypeOf<ScoreAnswer>();
    expectTypeOf<NoulAnswer>().toEqualTypeOf<{ noul: number; confidence: number }>();
    expectTypeOf<ChoiceAnswer>().toEqualTypeOf<{ choice: string; confidence: number }>();
    expectTypeOf<ScoreAnswer>().toEqualTypeOf<{ score: number; confidence: number }>();
    expect(await fake.judge(noul, state)).toEqual({ noul: 0.9, confidence: 0.8 });
    expect(await fake.judge(choice, state)).toEqual({ choice: 'a', confidence: 1 });
    expect(await fake.judge(score, state)).toEqual({ score: 3, confidence: 0.5 });
  });

  it('답 검증: 형식·선택지·범위', () => {
    expect(() => parseJudgeAnswer(noul, { noul: 1.2, confidence: 1 })).toThrow(JudgeAnswerError);
    expect(() => parseJudgeAnswer(noul, { yes: 0.2, confidence: 1 })).toThrow(JudgeAnswerError);
    expect(() => parseJudgeAnswer(choice, { choice: 'c', confidence: 1 })).toThrow(/선택지 밖/);
    expect(() => parseJudgeAnswer(score, { score: 11, confidence: 1 })).toThrow(/범위 밖/);
  });

  it('state는 메타데이터 필드만 (strict)', () => {
    expect(() => JudgeStateSchema.parse({ itemTitle: 't', expectedPath: 'a', source: 'x' })).toThrow();
    expect(() => JudgeStateSchema.parse({ itemTitle: 't', expectedPath: 'a\nb' })).toThrow();
    expect(() =>
      JudgeStateSchema.parse({ itemTitle: 't', expectedPath: 'a', symbols: ['fn() {}'] }),
    ).toThrow();
  });

  it('답 JSON Schema', () => {
    expect(judgeAnswerJsonSchema(choice)).toEqual({
      type: 'object',
      properties: {
        choice: { type: 'string', enum: ['a', 'b'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['choice', 'confidence'],
      additionalProperties: false,
    });
  });
});
