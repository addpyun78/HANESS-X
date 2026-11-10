import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

export interface MockReply {
  status?: number;
  /** SSE 원문 조각들 (그대로 차례로 write) */
  chunks?: string[];
  /** SSE가 아닌 본문 */
  text?: string;
}

export type MockHandler = (req: RecordedRequest, n: number) => MockReply;

/** 임의 포트의 모킹 HTTP 서버. 요청을 기록하고 handler가 정한 SSE를 돌려준다 */
export async function startMock(handler: MockHandler) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (raw += c));
    req.on('end', () => {
      const rec: RecordedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      };
      requests.push(rec);
      const reply = handler(rec, requests.length - 1);
      if (reply.text !== undefined || reply.status) {
        res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
        res.end(reply.text ?? '');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const c of reply.chunks ?? []) res.write(c);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** data: JSON 줄들을 SSE 이벤트로 */
export function sse(...objs: unknown[]): string[] {
  return objs.map((o) => `data: ${typeof o === 'string' ? o : JSON.stringify(o)}\n\n`);
}

/** event: 이름 + data 형식 (Anthropic) */
export function sseEvents(...evs: [string, unknown][]): string[] {
  return evs.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
}

/** OpenAI 형식 텍스트 응답 */
export function openaiText(text: string): string[] {
  const half = Math.ceil(text.length / 2);
  return sse(
    { choices: [{ index: 0, delta: { role: 'assistant', content: text.slice(0, half) } }] },
    { choices: [{ index: 0, delta: { content: text.slice(half) }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } },
    '[DONE]',
  );
}

/** OpenAI 형식 도구 호출 응답 (인자를 여러 조각으로 나눠 보낸다) */
export function openaiToolCall(id: string, name: string, args: Record<string, unknown>): string[] {
  const s = JSON.stringify(args);
  const a = s.slice(0, 5);
  const b = s.slice(5);
  return sse(
    {
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] },
        },
      ],
    },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: a } }] } }] },
    {
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: b } }] },
          finish_reason: 'tool_calls',
        },
      ],
    },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 7 } },
    '[DONE]',
  );
}
