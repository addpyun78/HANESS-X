import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HookBus } from '@harness-x/kernel';
import { HarnessEventSchema, type HarnessEvent } from '@harness-x/protocol';
import { ollamaEngine } from '../src/index.js';
import { openaiText, openaiToolCall, startMock } from './mock-server.js';

async function collect(it: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('openai-compat 도구 루프 (모킹 서버)', () => {
  let dir: string;
  let mock: Awaited<ReturnType<typeof startMock>> | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hx-oa-'));
    writeFileSync(join(dir, 'hello.txt'), 'secret-word: pineapple\n');
  });
  afterEach(async () => {
    await mock?.close();
    mock = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('모델이 read_file을 1회 호출 → 결과를 받아 → 답한다', async () => {
    mock = await startMock((req, n) =>
      n === 0
        ? { chunks: openaiToolCall('call_a', 'read_file', { path: 'hello.txt' }) }
        : { chunks: openaiText('The secret word is pineapple.') },
    );
    const engine = ollamaEngine({ baseUrl: `${mock.url}/v1`, defaultModel: 'qwen3' });
    const run = engine.run({ sessionId: 's1', prompt: 'hello.txt의 비밀 단어는?', cwd: dir });
    const events = await collect(run.events);
    expect(await run.done).toEqual({ exitCode: 0 });
    for (const e of events) HarnessEventSchema.parse(e);

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'tool_call')).toHaveLength(1);
    expect(events.find((e) => e.type === 'tool_call')).toMatchObject({
      callId: 'call_a',
      tool: 'read_file',
      input: { path: 'hello.txt' },
      engineId: 'openai-compat:ollama',
    });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      callId: 'call_a',
      ok: true,
      output: 'secret-word: pineapple\n',
    });
    expect(events.filter((e) => e.type === 'assistant_text' && !e.partial).at(-1)).toMatchObject({
      text: 'The secret word is pineapple.',
    });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
    expect(types.filter((t) => t === 'usage')).toHaveLength(2);

    // 도구 정의 주입 + 결과 반환 형식
    expect(mock.requests).toHaveLength(2);
    const first = mock.requests[0]!.body as { tools: { function: { name: string } }[]; messages: unknown[] };
    expect(first.tools.map((t) => t.function.name)).toEqual(['read_file', 'list_dir', 'write_file']);
    const second = mock.requests[1]!.body as { messages: Record<string, unknown>[] };
    expect(second.messages.at(-2)).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call_a',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"hello.txt"}' },
        },
      ],
    });
    expect(second.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call_a',
      content: 'secret-word: pineapple\n',
    });
  });

  it('tool.before deny는 도구를 실행하지 않고 거부 사유를 모델에 돌려준다, tool.after 발생', async () => {
    mock = await startMock((req, n) =>
      n === 0
        ? { chunks: openaiToolCall('w1', 'write_file', { path: 'x.txt', content: 'hi' }) }
        : { chunks: openaiText('ok') },
    );
    const hooks = new HookBus();
    hooks.onBlocking('tool.before', (ctx) =>
      ctx.tool === 'write_file' ? { decision: 'deny', reason: '계획 전 쓰기 금지' } : undefined,
    );
    const after: unknown[] = [];
    hooks.onNotify('tool.after', (ctx) => void after.push({ tool: ctx.tool, ok: ctx.ok }));
    const engine = ollamaEngine({ baseUrl: mock.url, defaultModel: 'm', hooks });
    const events = await collect(engine.run({ sessionId: 's', prompt: 'write', cwd: dir }).events);
    await hooks.drain();
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      ok: false,
      output: { denied: true },
    });
    expect(events.some((e) => e.type === 'file_change')).toBe(false);
    const msgs = (mock.requests[1]!.body as { messages: { role: string; content: string }[] }).messages;
    expect(msgs.at(-1)!.content).toContain('계획 전 쓰기 금지');
    expect(after).toEqual([{ tool: 'write_file', ok: false }]);
  });

  it('워크스페이스 밖 읽기는 오류 결과, 30회 반복 상한에서 max_turns', async () => {
    mock = await startMock(() => ({
      chunks: openaiToolCall('r', 'read_file', { path: '../../etc/passwd' }),
    }));
    const engine = ollamaEngine({ baseUrl: mock.url, defaultModel: 'm' });
    const events = await collect(engine.run({ sessionId: 's', prompt: 'loop', cwd: dir }).events);
    expect(mock.requests).toHaveLength(30);
    const res = events.find((e) => e.type === 'tool_result');
    expect(res).toMatchObject({ ok: false });
    expect(JSON.stringify(res)).toContain('워크스페이스 밖');
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'max_turns' });
  });

  it('서버 연결 실패는 error(network) + turn_end error, exitCode 1', async () => {
    const engine = ollamaEngine({ baseUrl: 'http://127.0.0.1:9/v1', defaultModel: 'm' });
    const run = engine.run({ sessionId: 's', prompt: 'x', cwd: dir });
    const events = await collect(run.events);
    expect(events[0]).toMatchObject({ type: 'error', code: 'network' });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'error' });
    expect((await run.done).exitCode).toBe(1);
  });
});
