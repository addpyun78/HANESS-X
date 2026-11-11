import {
  createJudgeChain,
  type JudgeAnswer,
  type JudgeBackend,
  type JudgeChain,
  type JudgeEngineInfo,
  type JudgePrompt,
  type JudgeSettingsInput,
} from '@harness-x/judge';

/** 테스트용 판정 답 (실제 엔진·네트워크 호출 없음) */
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
  answers: (JudgeAnswer | undefined)[],
  meta: { id?: string; via?: 'engine' | 'local'; engineId?: string } = {},
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
      return answers[Math.min(i++, answers.length - 1)];
    },
  };
  return backend;
}

export const subscription = (id: string, over: Partial<JudgeEngineInfo> = {}): JudgeEngineInfo => ({
  id,
  detected: true,
  loggedIn: true,
  authMode: 'subscription',
  ...over,
});

/**
 * 진짜 judge 체인(createJudgeChain)에 가짜 판정기만 끼운다.
 * Ollama는 꺼져 있고, 구독 엔진 1개(codex)가 로그인돼 있다 → ③ 구독 엔진이 판정한다.
 */
export function fakeChain(
  answers: (JudgeAnswer | undefined)[],
  settings: JudgeSettingsInput = {},
  engines: JudgeEngineInfo[] = [subscription('codex')],
): { chain: JudgeChain; backend: ReturnType<typeof scriptedBackend> } {
  const backend = scriptedBackend(answers, { id: 'engine:codex', engineId: 'codex' });
  const chain = createJudgeChain(settings, {
    listEngines: () => engines,
    probeOllama: async () => ({ running: false, models: [] }),
    createEngineJudge: () => backend,
    createLocalJudge: () => backend,
  });
  return { chain, backend };
}
