import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnginesSettings } from '../src/engines-settings.js';
import { EventLog } from '../src/event-log.js';
import { buildEngineEnv, memoryBackend, MissingApiKeyError, SecretStore } from '../src/secrets.js';
import { tempDir, textEvent } from './helpers.js';

/** 자식 프로세스에서 env 값 읽기 (키 원문은 메모리에서만 비교) */
function childEnv(env: NodeJS.ProcessEnv, names: string[]): Record<string, string | null> {
  const out = execFileSync(
    process.execPath,
    [
      '-e',
      `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map(n=>[n,process.env[n]??null]))))`,
    ],
    { env, encoding: 'utf8' },
  );
  return JSON.parse(out);
}

/** 폴더 아래 모든 파일에서 문자열 검색 (grep -r) → 일치 파일 수 */
function grepCount(dir: string, needle: string): number {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) n += grepCount(p, needle);
    else if (readFileSync(p).includes(needle)) n++;
  }
  return n;
}

describe('13.3 apiKey 모드: 실행 시 환경변수로만 주입', () => {
  it('자식 프로세스 env에 키가 있고, 디스크 파일 grep 0건', () => {
    const t = tempDir();
    try {
      const home = join(t.dir, 'home');
      mkdirSync(home, { recursive: true });
      writeFileSync(
        join(home, 'engines-settings.yaml'),
        'engines:\n  claude-code:\n    mode: apiKey\n  codex:\n    mode: apiKey\n  antigravity:\n    mode: apiKey\n',
      );
      const settings = loadEnginesSettings(join(home, 'engines-settings.yaml'));
      const store = new SecretStore(memoryBackend());
      const keys = {
        'claude-code': `sk-ant-test-${randomBytes(12).toString('hex')}`,
        codex: `sk-proj-test-${randomBytes(12).toString('hex')}`,
        antigravity: `AIzaTest${randomBytes(12).toString('hex')}`,
      };
      for (const [id, k] of Object.entries(keys)) store.setApiKey(id, k);
      const log = new EventLog({ root: join(home, 'logs') });

      const expectVar = {
        'claude-code': 'ANTHROPIC_API_KEY',
        codex: 'OPENAI_API_KEY',
        antigravity: 'GEMINI_API_KEY',
      };
      for (const [id, varName] of Object.entries(expectVar)) {
        const env = buildEngineEnv({
          engineId: id,
          mode: settings.engines[id]!.mode,
          store,
          baseEnv: { PATH: process.env.PATH, OPENAI_API_KEY: 'stale-from-shell' },
        });
        const seen = childEnv(env, ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']);
        expect(seen[varName]).toBe(keys[id as keyof typeof keys]);
        // 다른 엔진 키·셸에 남아 있던 키는 새지 않는다
        for (const other of Object.values(expectVar)) if (other !== varName) expect(seen[other]).toBeNull();
        // 실행 기록은 남기되 env는 기록하지 않는다
        log.append(textEvent('s1', `spawn ${id}`, { type: 'engine_spawn', engine: id }));
      }
      log.flush();
      log.close();

      for (const k of Object.values(keys)) expect(grepCount(t.dir, k)).toBe(0);
      expect(grepCount(t.dir, 'engine_spawn')).toBeGreaterThan(0); // 실제로 파일이 쓰였는지 확인
    } finally {
      t.cleanup();
    }
  });

  it('키체인에 키가 없으면 실행 거부', () => {
    expect(() =>
      buildEngineEnv({
        engineId: 'codex',
        mode: 'apiKey',
        store: new SecretStore(memoryBackend()),
        baseEnv: {},
      }),
    ).toThrow(MissingApiKeyError);
  });

  it('process.env를 바꾸지 않는다', () => {
    const store = new SecretStore(memoryBackend());
    store.setApiKey('codex', 'sk-proj-xxxxxxxxxxxxxxxxxxxxxx');
    const before = process.env.OPENAI_API_KEY;
    buildEngineEnv({ engineId: 'codex', mode: 'apiKey', store });
    expect(process.env.OPENAI_API_KEY).toBe(before);
  });
});
