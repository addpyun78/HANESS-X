import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { HARNESS_TOOLS } from '../src/index.js';
import { connectHttp, connectStdio, tempDir } from './helpers.js';

// 23.1 MCP 서버 기동 — inspector 대신 MCP SDK 클라이언트로 두 전송 모두 연결·도구 목록 확인
describe('23.1 MCP transports', () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  it('stdio: initialize + tools/list', async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const c = await connectStdio(t.dir);
    cleanups.push(c.close);
    expect(c.client.getServerVersion()?.name).toBe('harness');
    const { tools } = await c.client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual([...HARNESS_TOOLS].sort());
  });

  it('streamable HTTP: initialize + tools/list, 세션 ID 발급', async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const c = await connectHttp(t.dir);
    cleanups.push(c.close);
    const { tools } = await c.client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual([...HARNESS_TOOLS].sort());
    expect(c.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it('streamable HTTP: 토큰이 있으면 Bearer 없이 401', async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const c = await connectHttp(t.dir, 'secret-token');
    cleanups.push(c.close);
    expect((await c.client.listTools()).tools.length).toBe(5);
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    const bad = new Client({ name: 'x', version: '0' });
    await expect(bad.connect(new StreamableHTTPClientTransport(new URL(c.url)))).rejects.toThrow();
  });
});
