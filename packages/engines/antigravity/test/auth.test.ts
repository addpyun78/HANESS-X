import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HarnessEvent } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createAntigravityEngine } from '../src/engine.js';
import { AGY_LOGIN_HINT } from '../src/errors.js';
import { AgyStreamParser } from '../src/parser.js';

const fx = (n: string) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));

describe('16.4 헤드리스 미로그인 → "터미널에서 로그인" 안내 (샘플 기반, 실제 로그인 없음)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function runFake(env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'hx-agy-auth-'));
    dirs.push(dir);
    const engine = createAntigravityEngine({ command: process.execPath, prefixArgs: [fx('fake-agy.mjs')] });
    const run = engine.run({ sessionId: 's1', cwd: dir, prompt: 'hi', env: { ...process.env, ...env } });
    const events: HarnessEvent[] = [];
    for await (const e of run.events) events.push(e);
    return { events, dir, ...(await run.done) };
  }

  it('AGY_ERROR UNAUTHENTICATED(stderr) + exit 1 → error(auth_required, 로그인 안내) + turn_end(error)', async () => {
    const { events, exitCode } = await runFake({
      HX_FAKE_STDERR: fx('headless-not-logged-in.stderr.txt'),
      HX_FAKE_EXIT: '1',
    });
    expect(exitCode).toBe(1);
    expect(events.map((e) => e.type)).toEqual(['error', 'turn_end']);
    expect(events[0]).toMatchObject({
      type: 'error',
      code: 'auth_required',
      retryable: false,
      engineId: 'antigravity',
    });
    expect(events[0]!.type === 'error' && events[0]!.message).toContain(AGY_LOGIN_HINT);
    expect(events[1]).toMatchObject({ reason: 'error' });
  });

  it('구조화 에러 없이 평문 stderr만 있어도 auth_required + 안내', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-agy-auth-'));
    dirs.push(dir);
    const stderr = join(dir, 'stderr.txt');
    writeFileSync(stderr, 'Error: not logged in. Please sign in with `agy` first.\n');
    const { events } = await runFake({ HX_FAKE_STDERR: stderr, HX_FAKE_EXIT: '2' });
    expect(events[0]).toMatchObject({ type: 'error', code: 'auth_required' });
    expect(events[0]!.type === 'error' && events[0]!.message).toContain('터미널에서 `agy`');
  });

  it('auth_required가 아닌 오류에는 로그인 안내를 붙이지 않는다', () => {
    const p = new AgyStreamParser();
    const [e] = p.stderrLine('AGY_ERROR: {"code":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}');
    expect(e).toMatchObject({ code: 'quota_exceeded', message: 'Quota exceeded' });
  });
});
