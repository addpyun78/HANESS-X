import { afterEach, describe, expect, it } from 'vitest';
import { HARNESS_TOOLS, INSTALL_MCP_TOOLS, createHarnessMcpServer, openSession } from '../src/index.js';
import { connectHttp, tempDir } from './helpers.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// P2-A.7 AI에게 노출하는 설치 도구는 install.search·install.resolve·install.plan만
describe('P2-A.7 엔진 도구 목록: install.search·resolve·plan만', () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  it('설치 관리자를 붙이면 3개만 추가, execute·uninstall 없음, 호출은 계획까지만', async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const calls: string[] = [];
    const provider = {
      search: (q: string) => (calls.push(`search:${q}`), { candidates: [] }),
      resolve: (u: string) => (calls.push(`resolve:${u}`), { candidates: [] }),
      plan: (r: Record<string, unknown>) => (calls.push(`plan:${String(r.kind)}`), { id: 'plan_x' }),
    };
    const server = createHarnessMcpServer(openSession({ dir: t.dir }), { install: provider });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'engine', version: '0' });
    await client.connect(b);
    cleanups.push(() => client.close());
    const names = (await client.listTools()).tools.map((x) => x.name).sort();
    expect(names).toEqual([...HARNESS_TOOLS, ...INSTALL_MCP_TOOLS].sort());
    for (const n of names) expect(n).not.toMatch(/execute|uninstall|remove|update|import/);
    expect(INSTALL_MCP_TOOLS).toEqual(['install.search', 'install.resolve', 'install.plan']);
    await client.callTool({ name: 'install.search', arguments: { query: 'jq' } });
    await client.callTool({
      name: 'install.resolve',
      arguments: { url: 'https://ollama.com/library/qwen3' },
    });
    const r = await client.callTool({
      name: 'install.plan',
      arguments: { kind: 'winget', target: { id: 'jqlang.jq' } },
    });
    expect(r.structuredContent).toEqual({ id: 'plan_x' });
    expect(calls).toEqual(['search:jq', 'resolve:https://ollama.com/library/qwen3', 'plan:winget']);
    // 없는 도구 호출은 실패
    const bad = await client
      .callTool({ name: 'install.execute', arguments: { planId: 'plan_x' } })
      .catch(() => ({ isError: true }));
    expect(bad.isError).toBe(true);
  });

  it('설치 관리자 없이 띄우면 기존 5개 그대로', async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const c = await connectHttp(t.dir);
    cleanups.push(c.close);
    expect((await c.client.listTools()).tools.map((x) => x.name).sort()).toEqual([...HARNESS_TOOLS].sort());
  });
});
