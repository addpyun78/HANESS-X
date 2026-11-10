import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { HARNESS_TOOLS, NODE_OUTPUT_TOOL, createHarnessMcpServer, openSession } from '../src/index.js';
import { call, tempDir } from './helpers.js';

// T-042 42.1: 파이프라인 노드 출력 도구 node.output(json) — nodeOutput 옵션일 때만 등록
describe('42.1 node.output 도구 (opt-in)', () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  async function connect(nodeOutput: boolean) {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const server = createHarnessMcpServer(openSession({ dir: t.dir }), { nodeOutput });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(b);
    cleanups.push(() => client.close());
    return client;
  }

  it('기본 도구 목록에는 없고, nodeOutput이면 추가된다', async () => {
    const off = await connect(false);
    expect((await off.listTools()).tools.map((t) => t.name).sort()).toEqual([...HARNESS_TOOLS].sort());
    const on = await connect(true);
    expect((await on.listTools()).tools.map((t) => t.name)).toContain(NODE_OUTPUT_TOOL);
  });

  it('받은 json을 그대로 돌려준다', async () => {
    const c = await connect(true);
    const r = await call(c, NODE_OUTPUT_TOOL, { json: { tasks: ['a'] } });
    expect(r).toEqual({ isError: false, body: { accepted: true, json: { tasks: ['a'] } } });
  });
});
