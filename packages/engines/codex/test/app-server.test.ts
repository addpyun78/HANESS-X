import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventFactory } from '@harness-x/kernel';
import { HarnessEventSchema, type HarnessEvent } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAppServerMapper } from '../src/app-server.js';
import { createCodexEngine } from '../src/engine.js';

const fx = (n: string) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
const FAKE = fx('fake-codex.mjs');

function replay(name: string) {
  const m = new CodexAppServerMapper();
  const bodies = readFileSync(fx(name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => m.handle(JSON.parse(l)));
  return { m, bodies };
}

const TURN_EXPECTED = [
  { type: 'file_change', path: '/tmp/hx-fixture/hello.txt', change: 'create', diff: '+hello\n' },
  { type: 'file_change', path: '/tmp/hx-fixture/b.txt', change: 'rename', fromPath: '/tmp/hx-fixture/a.txt' },
  {
    type: 'tool_call',
    callId: 'call_c1',
    tool: 'shell',
    input: { command: "/bin/bash -lc 'cat hello.txt'", cwd: '/tmp/hx-fixture' },
  },
  { type: 'tool_result', callId: 'call_c1', ok: true, output: { output: 'hello\n', exitCode: 0 } },
  {
    type: 'tool_call',
    callId: 'call_c2',
    tool: 'shell',
    input: { command: "/bin/bash -lc 'ls missing'", cwd: '/tmp/hx-fixture' },
  },
  {
    type: 'tool_result',
    callId: 'call_c2',
    ok: false,
    output: { output: "ls: cannot access 'missing': No such file or directory\n", exitCode: 2 },
  },
  { type: 'tool_call', callId: 'call_m1', tool: 'harness.checklist.list', input: {} },
  {
    type: 'tool_result',
    callId: 'call_m1',
    ok: true,
    output: { content: [{ type: 'text', text: '[]' }], structuredContent: null },
  },
  { type: 'assistant_text', text: 'Created ', partial: true },
  { type: 'assistant_text', text: 'hello.txt.', partial: true },
  { type: 'assistant_text', text: 'Created hello.txt.', partial: false },
  { type: 'usage', inputTokens: 10100, outputTokens: 150, cacheReadTokens: 8192, quotaRatio: 0.43 },
  { type: 'turn_end', reason: 'completed' },
];

const USAGE_LIMIT_EXPECTED = [
  {
    type: 'error',
    code: 'network',
    message: 'stream disconnected before completion: error sending request',
    retryable: true,
  },
  {
    type: 'error',
    code: 'quota_exceeded',
    message:
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again in 2 hours 12 minutes.",
    retryable: false,
  },
  { type: 'turn_end', reason: 'error' },
];

describe('15.2 턴 알림 → HarnessEvent (녹화 리플레이)', () => {
  it('app-server-turn.jsonl 매핑 일치', () => {
    const { m, bodies } = replay('app-server-turn.jsonl');
    expect(bodies).toEqual(TURN_EXPECTED);
    expect(m.turnId).toBe('turn_fake_0001');
    const ev = eventFactory({ sessionId: 's1', engineId: 'codex' });
    for (const b of bodies) expect(() => HarnessEventSchema.parse(ev(b))).not.toThrow();
  });

  it('app-server-usage-limit.jsonl: 재시도 오류는 retryable, 한도 초과 1회만 + turn_end(error)', () => {
    expect(replay('app-server-usage-limit.jsonl').bodies).toEqual(USAGE_LIMIT_EXPECTED);
  });
});

describe('15.2 엔진 실행 (가짜 app-server 프로세스로 리플레이)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const setup = (env: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-codex-as-'));
    dirs.push(dir);
    const logFile = join(dir, 'log.jsonl');
    const engine = createCodexEngine({
      command: process.execPath,
      prefixArgs: [FAKE],
      transport: 'app-server',
    });
    const run = engine.run({
      sessionId: 's1',
      cwd: dir,
      prompt: 'create hello.txt and show it',
      permission: 'read-only',
      model: 'gpt-5.5-codex',
      env: { ...process.env, HX_FAKE_LOG: logFile, ...env },
    });
    const sent = () =>
      (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { method?: string; params?: Record<string, unknown> });
    return { dir, run, sent };
  };
  const collect = async (events: AsyncIterable<HarnessEvent>) => {
    const out: HarnessEvent[] = [];
    for await (const e of events) out.push(e);
    return out;
  };
  const strip = (e: HarnessEvent) => {
    const { id: _i, ts: _t, sessionId: _s, engineId: _e, ...rest } = e;
    return rest;
  };

  it('핸드셰이크 → thread/start → turn/start → 리플레이 이벤트 일치', async () => {
    const { dir, run, sent } = setup({
      HX_FAKE_REPLAY: fx('app-server-turn.jsonl'),
      HX_FAKE_RATELIMITS: fx('ratelimits-ok.json'),
    });
    const events = await collect(run.events);
    await run.done;
    expect(events.map(strip)).toEqual(TURN_EXPECTED);
    expect(events.every((e) => e.engineId === 'codex' && e.sessionId === 's1')).toBe(true);
    expect(run.engineSessionId()).toBe('thr_fake_0001');
    expect(run.transport()).toBe('app-server');
    const log = sent();
    expect(log.map((m) => m.method)).toEqual([
      'initialize',
      'initialized',
      'account/rateLimits/read',
      'thread/start',
      'turn/start',
    ]);
    expect(log[3]!.params).toEqual({
      cwd: dir,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      model: 'gpt-5.5-codex',
    });
    expect(log[4]!.params).toEqual({
      threadId: 'thr_fake_0001',
      input: [{ type: 'text', text: 'create hello.txt and show it', text_elements: [] }],
    });
  });

  it('한도 초과 턴 → quota_exceeded + turn_end(error)', async () => {
    const { run } = setup({ HX_FAKE_REPLAY: fx('app-server-usage-limit.jsonl') });
    expect((await collect(run.events)).map(strip)).toEqual(USAGE_LIMIT_EXPECTED);
  });

  it('interrupt → turn/interrupt 요청 후 turn_end(interrupted), 2초 내 종료', async () => {
    const { run, sent } = setup({ HX_FAKE_HANG: '1' });
    const got = collect(run.events);
    const end = Date.now() + 20_000;
    while (!sent().some((m) => m.method === 'turn/start')) {
      if (Date.now() > end) throw new Error('turn/start 대기 시간 초과');
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    await run.interrupt();
    await run.done;
    const events = await got;
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'interrupted' });
    expect(sent().map((m) => m.method)).toContain('turn/interrupt');
  });

  it('resumeId → thread/resume {threadId}', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-codex-as-'));
    dirs.push(dir);
    const logFile = join(dir, 'log.jsonl');
    const engine = createCodexEngine({
      command: process.execPath,
      prefixArgs: [FAKE],
      transport: 'app-server',
    });
    const run = engine.run({
      sessionId: 's1',
      cwd: dir,
      prompt: 'again',
      resumeId: 'thr_prev_42',
      env: { ...process.env, HX_FAKE_LOG: logFile, HX_FAKE_REPLAY: fx('app-server-turn.jsonl') },
    });
    await collect(run.events);
    const log = readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(log.find((m) => m.method === 'thread/resume')?.params).toMatchObject({ threadId: 'thr_prev_42' });
    expect(run.engineSessionId()).toBe('thr_prev_42');
  });
});
