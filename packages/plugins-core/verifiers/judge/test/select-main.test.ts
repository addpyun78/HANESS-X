import { describe, expect, it } from 'vitest';
import type { JudgeEngineInfo } from '../src/engine.js';
import { selectJudge, type JudgeSelectDeps } from '../src/select.js';
import { parseJudgeSettings } from '../src/settings.js';
import { scriptedBackend, YES } from './helpers.js';

const eng = (id: string): JudgeEngineInfo => ({
  id,
  detected: true,
  loggedIn: true,
  authMode: 'subscription',
});

function deps(main: string | undefined): JudgeSelectDeps {
  return {
    listEngines: () => [eng('claude-code'), eng('codex')],
    mainEngine: () => main,
    probeOllama: async () => ({ running: true, models: ['qwen2.5-coder:7b'] }),
    createEngineJudge: (e) => scriptedBackend([YES], { id: `engine:${e.id}`, engineId: e.id }),
    createLocalJudge: (o) =>
      scriptedBackend([YES], { id: `ollama:${o.model}`, via: 'local', engineId: 'ollama' }),
  };
}

describe('T-101 5C.3 판정(judge.engine)이 "자동"이면 메인 AI', () => {
  it('judge.engine 빈 값 + 메인 codex → codex (Ollama보다 먼저)', async () => {
    const s = await selectJudge(parseJudgeSettings({}), deps('codex'));
    expect(s).toMatchObject({ step: 1, engineId: 'codex' });
  });
  it('judge.engine을 직접 정했으면 그것이 먼저', async () => {
    const s = await selectJudge(parseJudgeSettings({ engine: 'claude-code' }), deps('codex'));
    expect(s).toMatchObject({ step: 1, engineId: 'claude-code' });
  });
  it('메인 AI가 없으면 예전 순서(Ollama → 구독 엔진) 그대로', async () => {
    const s = await selectJudge(parseJudgeSettings({}), deps(undefined));
    expect(s).toMatchObject({ step: 2, engineId: 'ollama' });
  });
});
