import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HarnessEventSchema, type HarnessEvent } from '@harness-x/protocol';
import { anthropicEngine, deepseekEngine, geminiEngine } from '../src/index.js';
import { openaiText, openaiToolCall, sse, sseEvents, startMock } from './mock-server.js';

async function collect(it: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/** 공통 확인: read_file 1회 → 결과 → 최종 답 */
function expectReadLoop(events: HarnessEvent[], engineId: string, answer: string) {
  for (const e of events) HarnessEventSchema.parse(e);
  expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(1);
  expect(events.find((e) => e.type === 'tool_call')).toMatchObject({
    tool: 'read_file',
    input: { path: 'a.txt' },
    engineId,
  });
  expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: true, output: 'banana' });
  expect(events.filter((e) => e.type === 'assistant_text' && !e.partial).at(-1)).toMatchObject({
    text: answer,
  });
  expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
  expect(events.some((e) => e.type === 'usage')).toBe(true);
}

describe('API 어댑터 3종 (모킹 HTTP)', () => {
  let dir: string;
  let mock: Awaited<ReturnType<typeof startMock>> | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hx-prov-'));
    writeFileSync(join(dir, 'a.txt'), 'banana');
  });
  afterEach(async () => {
    await mock?.close();
    mock = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('Anthropic Messages: tool_use 스트림 → tool_result 반환 → 답', async () => {
    mock = await startMock((_r, n) => ({
      chunks:
        n === 0
          ? sseEvents(
              [
                'message_start',
                { type: 'message_start', message: { usage: { input_tokens: 30, output_tokens: 1 } } },
              ],
              [
                'content_block_start',
                { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              ],
              [
                'content_block_delta',
                { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '읽어볼게요' } },
              ],
              ['content_block_stop', { type: 'content_block_stop', index: 0 }],
              [
                'content_block_start',
                {
                  type: 'content_block_start',
                  index: 1,
                  content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} },
                },
              ],
              [
                'content_block_delta',
                {
                  type: 'content_block_delta',
                  index: 1,
                  delta: { type: 'input_json_delta', partial_json: '{"path":' },
                },
              ],
              [
                'content_block_delta',
                {
                  type: 'content_block_delta',
                  index: 1,
                  delta: { type: 'input_json_delta', partial_json: '"a.txt"}' },
                },
              ],
              ['content_block_stop', { type: 'content_block_stop', index: 1 }],
              [
                'message_delta',
                { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } },
              ],
              ['message_stop', { type: 'message_stop' }],
            )
          : sseEvents(
              [
                'message_start',
                { type: 'message_start', message: { usage: { input_tokens: 50, output_tokens: 1 } } },
              ],
              [
                'content_block_start',
                { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              ],
              [
                'content_block_delta',
                {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: 'banana입니다' },
                },
              ],
              [
                'message_delta',
                { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
              ],
              ['message_stop', { type: 'message_stop' }],
            ),
    }));
    const engine = anthropicEngine({ baseUrl: mock.url });
    const events = await collect(
      engine.run({
        sessionId: 's',
        prompt: 'a.txt?',
        cwd: dir,
        model: 'claude-x',
        env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }).events,
    );
    expectReadLoop(events, 'anthropic-api', 'banana입니다');
    expect(events.find((e) => e.type === 'usage')).toMatchObject({ inputTokens: 30, outputTokens: 12 });

    const [r1, r2] = mock.requests;
    expect(r1!.url).toBe('/v1/messages');
    expect(r1!.headers['x-api-key']).toBe('sk-ant-test');
    expect(r1!.headers['anthropic-version']).toBe('2023-06-01');
    expect(r1!.body).toMatchObject({
      model: 'claude-x',
      stream: true,
      messages: [{ role: 'user', content: 'a.txt?' }],
    });
    expect(typeof r1!.body.system).toBe('string');
    expect((r1!.body.tools as { name: string; input_schema: unknown }[]).map((t) => t.name)).toEqual([
      'read_file',
      'list_dir',
      'write_file',
    ]);
    const msgs = r2!.body.messages as { role: string; content: unknown }[];
    expect(msgs.at(-2)).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: '읽어볼게요' },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.txt' } },
      ],
    });
    expect(msgs.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'banana' }],
    });
  });

  it('Gemini: functionCall → functionResponse → 답', async () => {
    mock = await startMock((_r, n) => ({
      chunks:
        n === 0
          ? sse({
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [{ functionCall: { name: 'read_file', args: { path: 'a.txt' } } }],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 6 },
            })
          : sse(
              { candidates: [{ content: { role: 'model', parts: [{ text: 'bana' }] } }] },
              {
                candidates: [{ content: { role: 'model', parts: [{ text: 'na' }] }, finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 2 },
              },
            ),
    }));
    const engine = geminiEngine({ baseUrl: mock.url });
    const events = await collect(
      engine.run({
        sessionId: 's',
        prompt: 'a.txt?',
        cwd: dir,
        model: 'gemini-x',
        env: { GEMINI_API_KEY: 'g-key' },
      }).events,
    );
    expectReadLoop(events, 'gemini-api', 'banana');
    const [r1, r2] = mock.requests;
    expect(r1!.url).toBe('/v1beta/models/gemini-x:streamGenerateContent?alt=sse');
    expect(r1!.headers['x-goog-api-key']).toBe('g-key');
    expect(r1!.body).toMatchObject({ contents: [{ role: 'user', parts: [{ text: 'a.txt?' }] }] });
    expect(r1!.body.systemInstruction).toBeDefined();
    const decl = (r1!.body.tools as { functionDeclarations: { name: string }[] }[])[0]!.functionDeclarations;
    expect(decl.map((d) => d.name)).toEqual(['read_file', 'list_dir', 'write_file']);
    const contents = r2!.body.contents as { role: string; parts: unknown[] }[];
    expect(contents.at(-2)).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'read_file', args: { path: 'a.txt' } } }],
    });
    expect(contents.at(-1)).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'read_file', response: { content: 'banana' } } }],
    });
  });

  it('DeepSeek (OpenAI 호환): Bearer 키, /chat/completions, 같은 루프', async () => {
    mock = await startMock((_r, n) => ({
      chunks: n === 0 ? openaiToolCall('call_ds', 'read_file', { path: 'a.txt' }) : openaiText('banana'),
    }));
    const engine = deepseekEngine({ baseUrl: `${mock.url}/v1` });
    const events = await collect(
      engine.run({ sessionId: 's', prompt: 'a.txt?', cwd: dir, env: { DEEPSEEK_API_KEY: 'ds-key' } }).events,
    );
    expectReadLoop(events, 'deepseek-api', 'banana');
    expect(mock.requests[0]!.url).toBe('/v1/chat/completions');
    expect(mock.requests[0]!.headers.authorization).toBe('Bearer ds-key');
    expect(mock.requests[0]!.body.model).toBe('deepseek-chat');
    expect((mock.requests[1]!.body.messages as unknown[]).at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call_ds',
      content: 'banana',
    });
  });

  it('키는 opts.env에서만: process.env에 있어도 env에 없으면 auth_required, 요청 없음', async () => {
    mock = await startMock(() => ({ chunks: openaiText('x') }));
    process.env.DEEPSEEK_API_KEY = 'should-not-be-used';
    try {
      for (const engine of [
        anthropicEngine({ baseUrl: mock.url }),
        geminiEngine({ baseUrl: mock.url }),
        deepseekEngine({ baseUrl: mock.url }),
      ]) {
        const run = engine.run({ sessionId: 's', prompt: 'x', cwd: dir });
        const events = await collect(run.events);
        expect(events[0]).toMatchObject({ type: 'error', code: 'auth_required' });
        expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'error' });
        expect((await run.done).exitCode).toBe(1);
      }
      expect(mock.requests).toHaveLength(0);
    } finally {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  it('429·401 응답은 rate_limited·auth_required 오류', async () => {
    mock = await startMock((_r, n) => ({ status: n === 0 ? 429 : 401, text: '{"error":"x"}' }));
    const a = await collect(
      anthropicEngine({ baseUrl: mock.url }).run({
        sessionId: 's',
        prompt: 'x',
        cwd: dir,
        env: { ANTHROPIC_API_KEY: 'k' },
      }).events,
    );
    expect(a[0]).toMatchObject({ type: 'error', code: 'rate_limited', retryable: true });
    const g = await collect(
      geminiEngine({ baseUrl: mock.url }).run({
        sessionId: 's',
        prompt: 'x',
        cwd: dir,
        env: { GEMINI_API_KEY: 'k' },
      }).events,
    );
    expect(g[0]).toMatchObject({ type: 'error', code: 'auth_required' });
  });
});
