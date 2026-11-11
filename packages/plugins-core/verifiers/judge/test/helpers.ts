import type { JudgeAnswer, JudgeBackend, JudgePrompt } from '../src/types.js';

export const YES: JudgeAnswer = {
  same_meaning: 'yes',
  difference_kind: 'equivalent',
  plain_reason: '같은 뜻이에요.',
};
export const NO: JudgeAnswer = {
  same_meaning: 'no',
  difference_kind: 'wrong-value',
  plain_reason: '값이 달라요.',
};

/** 정해진 답을 차례로 돌려주는 가짜 판정기 (호출 수·프롬프트 기록) */
export function scriptedBackend(
  answers: (JudgeAnswer | undefined | (() => Promise<JudgeAnswer | undefined>))[],
  meta: Partial<Pick<JudgeBackend, 'id' | 'via' | 'engineId'>> = {},
) {
  const prompts: JudgePrompt[] = [];
  let i = 0;
  const backend: JudgeBackend & { calls: number; prompts: JudgePrompt[] } = {
    id: meta.id ?? 'fake',
    via: meta.via ?? 'engine',
    engineId: meta.engineId ?? 'fake',
    calls: 0,
    prompts,
    async ask(prompt) {
      backend.calls++;
      prompts.push(prompt);
      const a = answers[Math.min(i++, answers.length - 1)];
      return typeof a === 'function' ? a() : a;
    },
  };
  return backend;
}
