import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@harness-x/protocol';
import { AcpEngine } from '../src/index.js';
import { collect, mockEngine, tempDir } from './helpers.js';

// 18.3 session/load 재개 (모킹 에이전트). 실제 claude-agent-acp 재개는 HX_REAL_ACP=1 일 때만 실행한다.

function finalText(events: HarnessEvent[]): string {
  const e = events.find((x) => x.type === 'assistant_text' && x.partial === false);
  return e && e.type === 'assistant_text' ? e.text : '';
}

describe('acp-generic session/load', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((c) => c()));

  it('resumeId → session/load로 같은 세션 재개, 재생(replay) 기록은 새 이벤트로 내지 않음', async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const env = { MOCK_ACP_STORE: join(dir, 'store') };

    const first = mockEngine({}, env).run({ sessionId: 'h1', prompt: 'first', cwd: dir });
    const ev1 = await collect(first.events);
    await first.done;
    expect(finalText(ev1)).toBe('echo: first (history=0)');
    const engineSession = first.engineSessionId();
    expect(engineSession).toMatch(/^mock-/);

    // 새 프로세스에서 재개
    const second = mockEngine({}, env).run({
      sessionId: 'h2',
      prompt: 'second',
      cwd: dir,
      resumeId: engineSession,
    });
    const ev2 = await collect(second.events);
    await second.done;
    expect(second.engineSessionId()).toBe(engineSession);
    expect(finalText(ev2)).toBe('echo: second (history=1)');
    const texts = ev2.flatMap((e) => (e.type === 'assistant_text' ? [e.text] : []));
    expect(texts.join('')).not.toContain('first');
    expect(ev2.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
  });

  it('에이전트가 loadSession을 지원하지 않으면 invalid_request', async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const run = mockEngine({}, { MOCK_ACP_NO_LOAD: '1' }).run({
      sessionId: 'h3',
      prompt: 'x',
      cwd: dir,
      resumeId: 'mock-old',
    });
    const events = await collect(run.events);
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'invalid_request' });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'error' });
    await run.done;
  });

  it('없는 세션 재개 → error + turn_end(error)', async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const run = mockEngine({}, { MOCK_ACP_STORE: join(dir, 'store') }).run({
      sessionId: 'h4',
      prompt: 'x',
      cwd: dir,
      resumeId: 'mock-missing',
    });
    const events = await collect(run.events);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'error' });
    await run.done;
  });
});

function onPath(bin: string): string | undefined {
  try {
    return execFileSync('which', [bin], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const realBin =
  process.env.HX_REAL_ACP === '1' ? (onPath('claude-agent-acp') ?? onPath('claude-code-acp')) : undefined;

describe.skipIf(!realBin)('실제 claude-agent-acp 재개 (HX_REAL_ACP=1)', () => {
  it('두 번째 실행이 session/load로 첫 세션을 이어간다', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const engine = new AcpEngine({
        id: 'claude-code',
        displayName: 'Claude Code (ACP)',
        command: realBin!,
      });
      const a = engine.run({
        sessionId: 'r1',
        prompt: 'Remember the word PINEAPPLE. Reply OK.',
        cwd: dir,
        env: process.env,
      });
      await collect(a.events);
      await a.done;
      const b = engine.run({
        sessionId: 'r2',
        prompt: 'What word did I ask you to remember? Reply with the word only.',
        cwd: dir,
        env: process.env,
        resumeId: a.engineSessionId(),
      });
      const ev = await collect(b.events);
      await b.done;
      expect(finalText(ev).toUpperCase()).toContain('PINEAPPLE');
    } finally {
      cleanup();
    }
  }, 180_000);
});
