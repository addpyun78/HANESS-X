import { afterEach, describe, expect, it } from 'vitest';
import { ModelApiError } from '@harness-x/kernel';
import { OpenAIChatClient, parseSse } from '../src/index.js';
import { openaiText, openaiToolCall, sse, startMock } from './mock-server.js';

async function* bytes(...parts: (string | Uint8Array)[]) {
  for (const p of parts) yield typeof p === 'string' ? new TextEncoder().encode(p) : p;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('SSE 파서', () => {
  it('청크 경계·주석·여러 줄 data·event/id·CRLF 처리', async () => {
    const msgs = await collect(
      parseSse(
        bytes(
          ': keepalive\n\nda',
          'ta: {"a":1}\n',
          '\ndata: x\ndata: y\n\nevent: ping\r',
          '\nid: 7\r\ndata: z\r\n\r\n',
        ),
      ),
    );
    expect(msgs).toEqual([{ data: '{"a":1}' }, { data: 'x\ny' }, { event: 'ping', id: '7', data: 'z' }]);
  });

  it('UTF-8 다중 바이트 문자가 청크 사이에서 잘려도 복원, 마지막 빈 줄 없어도 방출', async () => {
    const all = new TextEncoder().encode('data: 안녕\n\ndata: 끝');
    const msgs = await collect(parseSse(bytes(all.slice(0, 8), all.slice(8))));
    expect(msgs.map((m) => m.data)).toEqual(['안녕', '끝']);
  });
});

describe('OpenAIChatClient 스트리밍', () => {
  let mock: Awaited<ReturnType<typeof startMock>> | undefined;
  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('텍스트 델타를 onText로 흘리고 합쳐 반환, usage 파싱, 요청 형식 확인', async () => {
    mock = await startMock(() => ({ chunks: openaiText('안녕하세요 세계') }));
    const client = new OpenAIChatClient({ baseUrl: `${mock.url}/v1/`, model: 'qwen3', apiKey: 'sk-test' });
    const deltas: string[] = [];
    const turn = await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'read_file', description: 'r', parameters: { type: 'object' } }],
      onText: (d) => deltas.push(d),
    });
    expect(turn.text).toBe('안녕하세요 세계');
    expect(deltas.length).toBe(2);
    expect(turn.toolCalls).toEqual([]);
    expect(turn.usage).toEqual({ inputTokens: 20, outputTokens: 5 });
    expect(turn.finishReason).toBe('stop');
    const req = mock.requests[0]!;
    expect(req.url).toBe('/v1/chat/completions');
    expect(req.headers.authorization).toBe('Bearer sk-test');
    expect(req.body).toMatchObject({
      model: 'qwen3',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(req.body.tools).toEqual([
      { type: 'function', function: { name: 'read_file', description: 'r', parameters: { type: 'object' } } },
    ]);
  });

  it('tool_call 델타(인자 조각)를 index별로 이어 붙여 파싱', async () => {
    mock = await startMock(() => ({ chunks: openaiToolCall('call_1', 'read_file', { path: 'a.txt' }) }));
    const client = new OpenAIChatClient({ baseUrl: `${mock.url}/v1`, model: 'm' });
    const turn = await client.complete({ messages: [{ role: 'user', content: 'x' }], tools: [] });
    expect(turn.toolCalls).toEqual([{ id: 'call_1', name: 'read_file', arguments: { path: 'a.txt' } }]);
    expect(turn.finishReason).toBe('tool_calls');
    expect(mock.requests[0]!.headers.authorization).toBeUndefined();
  });

  it('여러 도구 호출 동시 스트리밍(교차 index), id 없는 호출은 생성', async () => {
    mock = await startMock(() => ({
      chunks: sse(
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { name: 'list_dir', arguments: '{"pa' } }] } },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 1, id: 'c2', function: { name: 'read_file', arguments: '{}' } }],
              },
            },
          ],
        },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"."}' } }] } }] },
        '[DONE]',
      ),
    }));
    const turn = await new OpenAIChatClient({ baseUrl: mock.url, model: 'm' }).complete({
      messages: [],
      tools: [],
    });
    expect(turn.toolCalls.map((c) => [c.name, c.arguments])).toEqual([
      ['list_dir', { path: '.' }],
      ['read_file', {}],
    ]);
    expect(turn.toolCalls[0]!.id).toMatch(/^call_/);
    expect(turn.toolCalls[1]!.id).toBe('c2');
  });

  it('HTTP 오류는 상태 코드가 담긴 ModelApiError', async () => {
    mock = await startMock(() => ({ status: 401, text: '{"error":"bad key"}' }));
    const p = new OpenAIChatClient({ baseUrl: mock.url, model: 'm' }).complete({ messages: [], tools: [] });
    await expect(p).rejects.toBeInstanceOf(ModelApiError);
    await expect(p).rejects.toMatchObject({ status: 401 });
  });
});
