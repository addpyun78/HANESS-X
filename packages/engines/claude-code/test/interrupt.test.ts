import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HarnessEvent } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaudeCodeEngine } from '../src/engine.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-long-claude.mjs', import.meta.url));

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(cond: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function runAndInterrupt(extraEnv: Record<string, string>, via: 'interrupt' | 'signal') {
  const dir = mkdtempSync(join(tmpdir(), 'hx-claude-int-'));
  dirs.push(dir);
  const pidFile = join(dir, 'pids');
  const ac = new AbortController();
  const engine = createClaudeCodeEngine({ command: process.execPath, prefixArgs: [FAKE] });
  const run = engine.run({
    sessionId: 's1',
    cwd: dir,
    prompt: 'long task',
    env: { ...process.env, HX_PID_FILE: pidFile, ...extraEnv },
    signal: ac.signal,
  });
  const events: HarnessEvent[] = [];
  const consumed = (async () => {
    for await (const e of run.events) events.push(e);
  })();
  await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').includes(' '));
  await waitFor(() => run.engineSessionId() === 'fake-session-1');
  const [child, grandchild] = readFileSync(pidFile, 'utf8').split(' ').map(Number) as [number, number];
  expect(isAlive(child) && isAlive(grandchild)).toBe(true);

  const t0 = Date.now();
  if (via === 'interrupt') await run.interrupt();
  else ac.abort();
  await run.done;
  await consumed;
  const elapsed = Date.now() - t0;
  await waitFor(() => !isAlive(grandchild), 2000);
  return { elapsed, events, child, grandchild };
}

describe.skipIf(process.platform === 'win32')('14.6 interrupt (프로세스 그룹 종료)', () => {
  it('interrupt() → 자식·손자 모두 2초 내 종료, turn_end(interrupted)', async () => {
    const r = await runAndInterrupt({}, 'interrupt');
    expect(r.elapsed).toBeLessThan(2000);
    expect(isAlive(r.child)).toBe(false);
    expect(isAlive(r.grandchild)).toBe(false);
    expect(r.events.at(-1)).toMatchObject({
      type: 'turn_end',
      reason: 'interrupted',
      engineId: 'claude-code',
    });
  });

  it('SIGTERM을 무시해도 SIGKILL 승격으로 유예 3초(T-101 2A.4) 뒤 종료 (AbortSignal 경로)', async () => {
    const r = await runAndInterrupt({ HX_IGNORE_TERM: '1' }, 'signal');
    expect(r.elapsed).toBeLessThan(5000);
    expect(isAlive(r.child)).toBe(false);
    expect(isAlive(r.grandchild)).toBe(false);
    expect(r.events.map((e) => e.type)).toEqual(['turn_end']);
  });

  it('없는 실행 파일 → error(engine_crashed) + turn_end(error)', async () => {
    const engine = createClaudeCodeEngine({ command: 'hx-no-such-claude-binary' });
    const run = engine.run({ sessionId: 's1', cwd: tmpdir(), prompt: 'x' });
    const events: HarnessEvent[] = [];
    for await (const e of run.events) events.push(e);
    expect(events.map((e) => e.type)).toEqual(['error', 'turn_end']);
    expect(events[0]).toMatchObject({ code: 'engine_crashed' });
  });
});
