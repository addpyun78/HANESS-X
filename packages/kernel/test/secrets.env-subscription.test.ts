import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  API_KEY_ENV_VARS,
  buildEngineEnv,
  memoryBackend,
  RELATED_CREDENTIAL_ENV_VARS,
  SecretStore,
} from '../src/secrets.js';

const ALL = [...API_KEY_ENV_VARS, ...RELATED_CREDENTIAL_ENV_VARS];

describe('13.4 subscription 모드: 키 환경변수를 제거한 env로 실행', () => {
  it('셸에 키가 있어도 자식 프로세스 env에는 없다', () => {
    const baseEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: '/home/u', KEEP_ME: '1' };
    for (const v of ALL) baseEnv[v] = `leaked-${v}`;
    baseEnv.openai_api_key = 'lowercase-leak'; // Windows env는 대소문자 무시
    const store = new SecretStore(memoryBackend());
    store.setApiKey('claude-code', 'sk-ant-should-not-be-used-xxxxxxxx');

    for (const engineId of ['claude-code', 'codex', 'antigravity']) {
      const env = buildEngineEnv({ engineId, mode: 'subscription', store, baseEnv });
      const seen = JSON.parse(
        execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'], {
          env,
          encoding: 'utf8',
        }),
      ) as Record<string, string>;
      for (const v of ALL) expect(seen[v], `${engineId} ${v}`).toBeUndefined();
      expect(Object.keys(seen).some((k) => /api_key|auth_token/i.test(k))).toBe(false);
      expect(seen.KEEP_ME).toBe('1');
    }
    // 원본 env는 그대로
    expect(baseEnv.ANTHROPIC_API_KEY).toBe('leaked-ANTHROPIC_API_KEY');
  });

  it('대상 변수에 ANTHROPIC/OPENAI/GEMINI_API_KEY 포함', () => {
    expect([...API_KEY_ENV_VARS]).toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']);
  });
});
