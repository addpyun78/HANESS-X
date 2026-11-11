import { describe, expect, it } from 'vitest';
import { createJudgeChain } from '../src/chain.js';
import type { JudgeEngineInfo } from '../src/engine.js';
import { selectJudge, type JudgeSelectDeps } from '../src/select.js';
import { parseJudgeSettings } from '../src/settings.js';
import type { JudgeBackend } from '../src/types.js';
import { scriptedBackend, YES } from './helpers.js';

const eng = (id: string, over: Partial<JudgeEngineInfo> = {}): JudgeEngineInfo => ({
  id,
  detected: true,
  loggedIn: true,
  authMode: 'subscription',
  ...over,
});

const OLLAMA_UP = async () => ({ running: true, models: ['qwen2.5-coder:7b'] });
const OLLAMA_DOWN = async () => ({ running: false, models: [] });

/** 엔진·로컬 판정기를 가짜로 바꾸고, 어떤 판정기가 만들어졌는지 기록 */
function deps(engines: JudgeEngineInfo[], probe: JudgeSelectDeps['probeOllama']) {
  const made: string[] = [];
  const d: JudgeSelectDeps = {
    listEngines: () => engines,
    probeOllama: probe,
    createEngineJudge: (e, o) => {
      made.push(`engine:${e.id}${o.model ? `@${o.model}` : ''}`);
      return scriptedBackend([YES], { id: `engine:${e.id}`, engineId: e.id });
    },
    createLocalJudge: (o) => {
      made.push(`local:${o.model}`);
      return scriptedBackend([YES], { id: `ollama:${o.model}`, via: 'local', engineId: 'ollama' });
    },
  };
  return { d, made };
}

const req = {
  kind: 'path',
  expected: '하네스/모바일',
  actual: 'ai/mobile',
  itemTitle: '폴더',
  sessionId: 's',
};

describe('E.7 ③ 자동 선택은 작성 엔진과 다른 엔진 우선, 없으면 같은 엔진 + same_engine_judge', () => {
  it('작성=codex, 구독 엔진 codex·claude → claude 선택, sameEngineJudge=false', async () => {
    const { d } = deps([eng('codex'), eng('claude')], OLLAMA_DOWN);
    const s = await selectJudge(parseJudgeSettings({}), d, 'codex');
    expect(s).toMatchObject({ step: 3, engineId: 'claude-code', sameEngineJudge: false });
    const out = await createJudgeChain({}, d).judge({ ...req, authorEngineId: 'codex' });
    expect(out).toMatchObject({ engineId: 'claude-code', sameEngineJudge: false });
  });

  it('구독 엔진이 작성 엔진뿐 → 같은 엔진 + sameEngineJudge=true (별칭 claude ↔ claude-code 같음)', async () => {
    const { d } = deps([eng('claude')], OLLAMA_DOWN);
    const s = await selectJudge(parseJudgeSettings({}), d, 'claude-code');
    expect(s).toMatchObject({ step: 3, engineId: 'claude-code', sameEngineJudge: true });
    const out = await createJudgeChain({}, d).judge({ ...req, authorEngineId: 'claude-code' });
    expect(out.sameEngineJudge).toBe(true);
  });

  it('①은 사용자 설정이므로 같은 엔진이어도 그대로 쓰고 표시만', async () => {
    const { d, made } = deps([eng('codex'), eng('claude-code')], OLLAMA_DOWN);
    const s = await selectJudge(parseJudgeSettings({ engine: 'codex' }), d, 'codex');
    expect(s).toMatchObject({ step: 1, engineId: 'codex', sameEngineJudge: true });
    expect(made).toEqual(['engine:codex']);
  });

  it('작성 엔진 정보가 없으면 첫 구독 엔진, sameEngineJudge=false', async () => {
    const { d } = deps([eng('antigravity'), eng('codex')], OLLAMA_DOWN);
    const s = await selectJudge(parseJudgeSettings({}), d);
    expect(s).toMatchObject({ step: 3, engineId: 'antigravity', sameEngineJudge: false });
  });

  it('로컬(②)이 있으면 작성 엔진과 무관하게 로컬, sameEngineJudge=false', async () => {
    const { d } = deps([eng('codex')], OLLAMA_UP);
    const s = await selectJudge(parseJudgeSettings({}), d, 'codex');
    expect(s).toMatchObject({ step: 2, engineId: 'ollama', sameEngineJudge: false });
    const b = (s as { backend: JudgeBackend }).backend;
    expect(b.via).toBe('local');
  });
});
