import { afterEach, describe, expect, it } from 'vitest';
import { parseHarnessEvent, type HarnessEvent } from '@harness-x/protocol';
import { collect, mockEngine, tempDir } from './helpers.js';

// 18.1 initialize · session/new · session/prompt (모킹 ACP 에이전트, 실제 자식 프로세스 + stdio)

describe('acp-generic client', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((c) => c()));

  it('initialize → session/new → prompt, 텍스트를 HarnessEvent로 정규화', async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const run = mockEngine().run({ sessionId: 's1', prompt: 'hello', cwd: dir, itemId: 'item-1' });
    const events = await collect(run.events);
    for (const e of events) expect(() => parseHarnessEvent(e)).not.toThrow();
    expect(
      events.every((e) => e.sessionId === 's1' && e.engineId === 'mock-acp' && e.itemId === 'item-1'),
    ).toBe(true);

    const partial = events.filter((e) => e.type === 'assistant_text' && e.partial);
    expect(partial).toHaveLength(2);
    const final = events.find((e) => e.type === 'assistant_text' && e.partial === false);
    expect(final && final.type === 'assistant_text' && final.text).toBe('echo: hello (history=0)');
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });

    expect(run.engineSessionId()).toMatch(/^mock-/);
    expect(run.initializeResponse()?.agentInfo?.name).toBe('mock-acp-agent');
    await expect(run.done).resolves.toEqual({ exitCode: 0 });
  });

  it('tool_call / tool_call_update(diff) → tool_call · file_change · tool_result', async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const run = mockEngine().run({ sessionId: 's2', prompt: 'use a tool', cwd: dir });
    const events = await collect(run.events);
    const types = events.map((e) => e.type);
    expect(types.slice(0, 3)).toEqual(['tool_call', 'file_change', 'tool_result']);
    expect(events[0]).toMatchObject({
      type: 'tool_call',
      callId: 'call-1',
      tool: 'edit',
      input: { path: 'a.txt' },
    });
    expect(events[1]).toMatchObject({ type: 'file_change', change: 'create', diff: 'hi' });
    expect(events[2]).toMatchObject({
      type: 'tool_result',
      callId: 'call-1',
      ok: true,
      output: { written: true },
    });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
    await run.done;
  });

  it('MCP 서버 목록을 session/new에 넘긴다', async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const run = mockEngine().run({
      sessionId: 's3',
      prompt: 'x',
      cwd: dir,
      mcpServers: [
        { name: 'a', command: 'node', args: ['srv.js'], env: { K: 'v' } },
        { name: 'b', url: 'http://127.0.0.1:1/mcp', headers: { H: '1' } },
      ],
    });
    const events = await collect(run.events);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
    await run.done;
  });

  it('턴 도중 에이전트 종료 → error(engine_crashed) + turn_end(error)', async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const run = mockEngine().run({ sessionId: 's4', prompt: 'crash now', cwd: dir });
    const events = await collect(run.events);
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'engine_crashed' });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'error' });
    await expect(run.done).resolves.toEqual({ exitCode: 3 });
  });

  it('실행 파일이 없으면 error + turn_end(error)', async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const run = mockEngine({ command: 'hx-no-such-acp-agent-binary', args: [] }).run({
      sessionId: 's5',
      prompt: 'x',
      cwd: dir,
    });
    const events = await collect(run.events);
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'engine_crashed' });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'error' });
  });

  it('interrupt → session/cancel → turn_end(interrupted)', async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const run = mockEngine().run({ sessionId: 's6', prompt: 'slow job', cwd: dir });
    const seen: HarnessEvent[] = [];
    for await (const e of run.events) {
      seen.push(e);
      if (e.type === 'assistant_text' && e.partial) await run.interrupt();
    }
    expect(seen.at(-1)).toMatchObject({ type: 'turn_end', reason: 'interrupted' });
    await run.done;
  });
});
