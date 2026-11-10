import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HarnessEventSchema } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { quotaRatioFromRateLimits, rateLimitsToUsage } from '../src/app-server.js';
import { createCodexEngine } from '../src/engine.js';
import { classifyCodexError } from '../src/errors.js';

const fx = (n: string) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
const FAKE = fx('fake-codex.mjs');
const json = (n: string) => JSON.parse(readFileSync(fx(n), 'utf8'));

describe('15.3 account/rateLimits/read 쿼터 조회', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('응답 → usage 본문 (토큰 0, quotaRatio = 가장 높은 창 사용률)', () => {
    expect(rateLimitsToUsage(json('ratelimits-ok.json').result)).toEqual({
      type: 'usage',
      inputTokens: 0,
      outputTokens: 0,
      quotaRatio: 0.42,
    });
    expect(quotaRatioFromRateLimits({ rateLimits: { primary: { usedPercent: 130 } } })).toBe(1);
    expect(quotaRatioFromRateLimits({})).toBeUndefined();
  });

  it('quota(): app-server에 initialize → rateLimits/read만 보내고 usage 이벤트 생성 (모델 호출 없음)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-codex-q-'));
    dirs.push(dir);
    const logFile = join(dir, 'log.jsonl');
    const engine = createCodexEngine({ command: process.execPath, prefixArgs: [FAKE] });
    const ev = await engine.quota({
      sessionId: 's1',
      cwd: dir,
      env: { ...process.env, HX_FAKE_LOG: logFile, HX_FAKE_RATELIMITS: fx('ratelimits-ok.json') },
    });
    expect(HarnessEventSchema.parse(ev)).toMatchObject({
      type: 'usage',
      engineId: 'codex',
      sessionId: 's1',
      inputTokens: 0,
      outputTokens: 0,
      quotaRatio: 0.42,
    });
    const methods = readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l).method);
    expect(methods).toEqual(['initialize', 'initialized', 'account/rateLimits/read']);
  });

  it('실제 녹화된 401 응답 → reject, 메시지는 auth_required로 분류', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-codex-q-'));
    dirs.push(dir);
    const engine = createCodexEngine({ command: process.execPath, prefixArgs: [FAKE] });
    const err = await engine
      .quota({
        sessionId: 's1',
        cwd: dir,
        env: { ...process.env, HX_FAKE_RATELIMITS: fx('ratelimits-auth-error.real.json') },
      })
      .catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(classifyCodexError((err as Error).message).code).toBe('auth_required');
  });
});
