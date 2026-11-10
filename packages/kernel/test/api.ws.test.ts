import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { bootApi } from './api-fixtures.js';

describe('WebSocket /ws/events', () => {
  it('이벤트 1개 발행 시 클라이언트 수신', async () => {
    const api = await bootApi();
    const wsUrl =
      api.server.url.replace('http', 'ws') + `/ws/events?token=${api.server.token}&sessionId=s-ws`;
    const ws = new WebSocket(wsUrl);
    const msgs: { type: string; text?: string }[] = [];
    const got = new Promise<void>((res, rej) => {
      ws.on('message', (d) => {
        const m = JSON.parse(String(d));
        msgs.push(m);
        if (m.type === 'hello') {
          api.env.log.append({
            id: 'x1',
            ts: new Date().toISOString(),
            sessionId: 'other',
            type: 'assistant_text',
            text: 'skip',
          });
          api.env.log.append({
            id: 'x2',
            ts: new Date().toISOString(),
            sessionId: 's-ws',
            type: 'assistant_text',
            text: '안녕',
          });
        } else res();
      });
      ws.on('error', rej);
    });
    await got;
    expect(msgs.map((m) => m.type)).toEqual(['hello', 'assistant_text']);
    expect(msgs[1]?.text).toBe('안녕');
    ws.close();
    await api.close();
  });

  it('토큰 없는 WebSocket 연결 거부', async () => {
    const api = await bootApi();
    const ws = new WebSocket(api.server.url.replace('http', 'ws') + '/ws/events');
    const status = await new Promise<number>((res) =>
      ws.on('unexpected-response', (_req, r) => res(r.statusCode ?? 0)),
    );
    expect(status).toBe(401);
    await api.close();
  });
});
