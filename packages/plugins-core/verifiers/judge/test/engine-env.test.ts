import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { API_KEY_ENV_VARS, memoryBackend, RELATED_CREDENTIAL_ENV_VARS, SecretStore } from '@harness-x/kernel';
import { createEngineJudge, judgeEngineEnv, type JudgeSpawn } from '../src/engine.js';
import { buildJudgePrompt } from '../src/questions.js';

const replay = (name: string) =>
  readFileSync(new URL(`../fixtures/replays/${name}`, import.meta.url), 'utf8');

const prompt = buildJudgePrompt({
  kind: 'path',
  itemTitle: '모바일 앱 폴더',
  expected: '하네스/모바일',
  actual: 'ai/mobile',
});

interface SpawnCall {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

function replaySpawn(stdout: string, code = 0) {
  const calls: SpawnCall[] = [];
  const spawn: JudgeSpawn = async (command, args, opts) => {
    calls.push({ command, args, env: opts.env, cwd: opts.cwd });
    return { code, stdout, stderr: '' };
  };
  return { spawn, calls };
}

const KEY_ENV = {
  PATH: '/usr/bin',
  HOME: '/home/u',
  ANTHROPIC_API_KEY: 'sk-ant-should-not-leak-0000000000',
  OPENAI_API_KEY: 'sk-should-not-leak-1111111111111',
  GEMINI_API_KEY: 'AIza-should-not-leak',
  CODEX_API_KEY: 'x',
  GOOGLE_API_KEY: 'y',
};

const engine = (id: string, authMode: 'subscription' | 'apiKey' = 'subscription') => ({
  id,
  detected: true,
  loggedIn: true,
  authMode,
});

describe('E.6 구독 모드 자식 env에 API 키 없음 (T-013)', () => {
  const allKeyVars = [...API_KEY_ENV_VARS, ...RELATED_CREDENTIAL_ENV_VARS];

  for (const id of ['claude-code', 'codex', 'antigravity']) {
    it(`${id} 구독 모드: 자식 env에 키 변수 0개, 나머지 env는 유지`, async () => {
      const r = replaySpawn(
        replay(
          id === 'claude-code'
            ? 'claude-code.stdout'
            : id === 'codex'
              ? 'codex.stdout'
              : 'antigravity.stdout',
        ),
      );
      await createEngineJudge(engine(id), { spawn: r.spawn, baseEnv: KEY_ENV }).ask(prompt);
      const env = r.calls[0]!.env;
      for (const k of allKeyVars) expect(env[k]).toBeUndefined();
      expect(Object.values(env).join(' ')).not.toMatch(/should-not-leak/);
      expect(env.PATH).toBe('/usr/bin');
      expect(env.HOME).toBe('/home/u');
    });
  }

  it('API 키 모드: 그 엔진의 키 하나만 키체인에서 주입 (원래 env의 키는 버림)', () => {
    const store = new SecretStore(memoryBackend());
    store.setApiKey('codex', 'sk-from-keychain-2222222222222');
    const env = judgeEngineEnv(engine('codex', 'apiKey'), { baseEnv: KEY_ENV, secretStore: store });
    expect(env.OPENAI_API_KEY).toBe('sk-from-keychain-2222222222222');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it('API 키 모드인데 키가 없으면 실행하지 않고 undefined', async () => {
    const r = replaySpawn(replay('codex.stdout'));
    const store = new SecretStore(memoryBackend());
    const a = await createEngineJudge(engine('codex', 'apiKey'), {
      spawn: r.spawn,
      baseEnv: KEY_ENV,
      secretStore: store,
    }).ask(prompt);
    expect(a).toBeUndefined();
    expect(r.calls).toHaveLength(0);
  });
});
