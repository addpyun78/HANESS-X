import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventFactory } from '@harness-x/kernel';
import { HarnessEventSchema, type HarnessEvent } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createCodexEngine } from '../src/engine.js';
import { CodexExecParser } from '../src/exec-parser.js';

const fx = (n: string) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
const FAKE = fx('fake-codex.mjs');

function replay(name: string) {
  const p = new CodexExecParser();
  const bodies = readFileSync(fx(name), 'utf8')
    .split('\n')
    .flatMap((l) => p.line(l));
  return { p, bodies };
}

const SHELL_EXPECTED = [
  { type: 'tool_call', callId: 'item_1', tool: 'shell', input: { command: "/bin/bash -lc 'echo hi'" } },
  { type: 'tool_result', callId: 'item_1', ok: true, output: { output: 'hi\n', exitCode: 0 } },
  { type: 'tool_call', callId: 'item_2', tool: 'shell', input: { command: "/bin/bash -lc 'touch x'" } },
  {
    type: 'tool_result',
    callId: 'item_2',
    ok: false,
    output: { output: "touch: cannot touch 'x': Read-only file system\n", exitCode: 1 },
  },
  { type: 'file_change', path: '/tmp/hx-fixture/notes.md', change: 'create' },
  { type: 'file_change', path: '/tmp/hx-fixture/old.md', change: 'delete' },
  { type: 'file_change', path: '/tmp/hx-fixture/README.md', change: 'modify' },
  { type: 'tool_call', callId: 'item_4', tool: 'harness.checklist.list', input: {} },
  {
    type: 'tool_result',
    callId: 'item_4',
    ok: true,
    output: { content: [{ type: 'text', text: '[]' }], structured_content: null },
  },
  { type: 'assistant_text', text: 'done', partial: false },
  { type: 'usage', inputTokens: 11234, outputTokens: 87, cacheReadTokens: 9984 },
  { type: 'turn_end', reason: 'completed' },
];

describe('15.4 codex exec --json NDJSON 파서 (샘플 리플레이)', () => {
  it('exec-shell.jsonl 매핑 일치 + thread_id 수집', () => {
    const { p, bodies } = replay('exec-shell.jsonl');
    expect(p.sessionId()).toBe('019a7c2e-5b1d-7e30-9f4a-2c6d8e0b1a3f');
    expect(bodies).toEqual(SHELL_EXPECTED);
    const ev = eventFactory({ sessionId: 's1', engineId: 'codex' });
    for (const b of bodies) expect(() => HarnessEventSchema.parse(ev(b))).not.toThrow();
  });

  it('exec-auth-failed.jsonl: 재연결 오류는 retryable, turn.failed → auth_required + turn_end(error)', () => {
    const { bodies } = replay('exec-auth-failed.jsonl');
    expect(bodies.map((b) => b.type)).toEqual(['error', 'error', 'error', 'turn_end']);
    expect(bodies[0]).toMatchObject({ code: 'auth_required', retryable: true });
    expect(bodies[2]).toMatchObject({ code: 'auth_required', retryable: false });
    expect(bodies[3]).toEqual({ type: 'turn_end', reason: 'error' });
  });

  it('turn.completed 없이 종료 → finish가 error + turn_end', () => {
    expect(new CodexExecParser().finish(1, '')).toEqual([
      expect.objectContaining({ type: 'error', code: 'engine_crashed' }),
      { type: 'turn_end', reason: 'error' },
    ]);
  });
});

describe('15.4 폴백 경로 (엔진 실행)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const strip = (e: HarnessEvent) => {
    const { id: _i, ts: _t, sessionId: _s, engineId: _e, ...rest } = e;
    return rest;
  };

  it('auto: app-server initialize 실패(무응답) → exec --json으로 폴백해 같은 결과', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-codex-exec-'));
    dirs.push(dir);
    const logFile = join(dir, 'log.jsonl');
    const engine = createCodexEngine({
      command: process.execPath,
      prefixArgs: [FAKE],
      requestTimeoutMs: 1500,
    });
    const run = engine.run({
      sessionId: 's1',
      cwd: dir,
      prompt: 'Run echo hi',
      permission: 'read-only',
      env: {
        ...process.env,
        HX_FAKE_LOG: logFile,
        HX_FAKE_NO_INIT: '1',
        HX_FAKE_EXEC_REPLAY: fx('exec-shell.jsonl'),
      },
    });
    const events: HarnessEvent[] = [];
    for await (const e of run.events) events.push(e);
    await run.done;
    expect(run.transport()).toBe('exec');
    expect(events.map(strip)).toEqual(SHELL_EXPECTED);
    expect(run.engineSessionId()).toBe('019a7c2e-5b1d-7e30-9f4a-2c6d8e0b1a3f');
    const argv = readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((m) => m.argv)?.argv;
    expect(argv.slice(0, 5)).toEqual(['exec', '--json', '--sandbox', 'read-only', '--cd']);
    expect(argv.slice(-2)).toEqual(['--', 'Run echo hi']);
  });
});
