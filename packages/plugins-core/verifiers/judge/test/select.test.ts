import { describe, expect, it } from 'vitest';
import { createJudgeChain } from '../src/chain.js';
import type { JudgeEngineInfo } from '../src/engine.js';
import { selectJudge, type JudgeSelectDeps } from '../src/select.js';
import { parseJudgeSettings } from '../src/settings.js';
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
const OLLAMA_NO_MODEL = async () => ({ running: true, models: [] });

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

describe('E.2 선택 순서 ① judge.engine → ② 로컬 Ollama → ③ 구독 엔진 → ④ 승인 카드', () => {
  it('경로 1: ① 설정 엔진이 감지·로그인 OK → ① 사용 (judge.model 전달)', async () => {
    const { d, made } = deps([eng('codex'), eng('claude-code')], OLLAMA_UP);
    const s = await selectJudge(parseJudgeSettings({ engine: 'claude-code', model: 'sonnet' }), d);
    expect(s.step).toBe(1);
    expect(made).toEqual(['engine:claude-code@sonnet']);
    const out = await createJudgeChain({ engine: 'claude-code', samples: 3 }, d).judge(req);
    expect(out).toMatchObject({ verdict: 'equal', confidence: 1, engineId: 'claude-code', samples: 3 });
  });

  it('경로 2: ① 오프라인(로그아웃/미감지) → ② 로컬 Ollama', async () => {
    for (const offline of [
      eng('claude-code', { loggedIn: false }),
      eng('claude-code', { detected: false }),
    ]) {
      const { d, made } = deps([offline], OLLAMA_UP);
      const s = await selectJudge(parseJudgeSettings({ engine: 'claude' }), d);
      expect(s.step).toBe(2);
      expect(made).toEqual(['local:qwen2.5-coder:7b']);
    }
    const { d } = deps([], OLLAMA_UP);
    expect((await createJudgeChain({ engine: 'claude-code' }, d).judge(req)).engineId).toBe('ollama');
  });

  it('경로 3: ② 없음(꺼짐·모델 없음·설정 모델 없음) → ③ 로그인된 구독 엔진', async () => {
    for (const [probe, localModel] of [
      [OLLAMA_DOWN, ''],
      [OLLAMA_NO_MODEL, ''],
      [OLLAMA_UP, 'mistral:7b'],
    ] as const) {
      const { d, made } = deps([eng('codex')], probe);
      const s = await selectJudge(parseJudgeSettings({ local: { model: localModel } }), d);
      expect(s.step).toBe(3);
      expect(made).toEqual(['engine:codex']);
    }
  });

  it('③는 구독 모드 + 로그인 + 판정 가능한 엔진만 (API 키 모드·미지원 엔진 제외)', async () => {
    const { d } = deps(
      [eng('codex', { authMode: 'apiKey' }), eng('opencode'), eng('claude-code', { loggedIn: false })],
      OLLAMA_DOWN,
    );
    expect((await selectJudge(parseJudgeSettings({}), d)).step).toBe(4);
  });

  it('경로 4: 전부 불가 → ④ 승인 카드 (unavailable, 호출 0)', async () => {
    const { d, made } = deps([], OLLAMA_DOWN);
    expect(await selectJudge(parseJudgeSettings({ engine: 'codex' }), d)).toEqual({
      step: 4,
      reason: 'no-judge',
    });
    const out = await createJudgeChain({}, d).judge(req);
    expect(out).toEqual({ verdict: 'unavailable', confidence: 0, reason: 'no-judge' });
    expect(made).toEqual([]);
  });

  it('경로 5: semantic off → 선택·호출 없이 즉시 different', async () => {
    let listed = 0;
    const { d, made } = deps([eng('codex')], OLLAMA_UP);
    const counting = { ...d, listEngines: () => (listed++, d.listEngines()) };
    const out = await createJudgeChain({ semantic: 'off' }, counting).judge(req);
    expect(out).toEqual({ verdict: 'different', confidence: 0, reason: 'semantic-off' });
    expect(listed).toBe(0);
    expect(made).toEqual([]);
  });

  it('엔진 목록·Ollama 확인이 예외를 던져도 체인은 예외 없이 unavailable', async () => {
    const d: JudgeSelectDeps = {
      listEngines: () => {
        throw new Error('scanner down');
      },
      probeOllama: () => Promise.reject(new Error('x')),
    };
    await expect(createJudgeChain({}, d).judge(req)).resolves.toMatchObject({ verdict: 'unavailable' });
  });
});
