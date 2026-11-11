import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { HARNESS_TOOLS, createHarnessMcpServer, openSession } from '../src/index.js';
import { tempDir } from './helpers.js';

/**
 * T-100 P4-F.1 엔진(설계 AI 포함)에 보이는 MCP 도구 목록에 저장 관련 도구가 없다 (agent.save 없음).
 * 저장은 사람이 화면에서 누르는 POST /api/agents/save(클릭 토큰 필요)뿐이다.
 */
const SAVE_LIKE = /save|agent[._]|register|install|write[._]?file|persist/i;

describe('P4-F.1 MCP 도구 목록에 저장 도구 없음', () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  it('선언 목록(HARNESS_TOOLS)에 저장 관련 이름 0개', () => {
    expect(HARNESS_TOOLS.filter((t) => SAVE_LIKE.test(t))).toEqual([]);
  });

  for (const toolNames of ['dotted', 'underscore'] as const)
    for (const nodeOutput of [false, true])
      it(`tools/list (${toolNames}, node.output ${nodeOutput ? '켬' : '끔'}) → agent.save 없음`, async () => {
        const t = tempDir();
        cleanups.push(t.cleanup);
        const server = createHarnessMcpServer(openSession({ dir: t.dir }), { toolNames, nodeOutput });
        const [a, b] = InMemoryTransport.createLinkedPair();
        await server.connect(a);
        const client = new Client({ name: 'test', version: '0.0.0' });
        await client.connect(b);
        cleanups.push(() => client.close());
        const names = (await client.listTools()).tools.map((x) => x.name);
        expect(names.length).toBeGreaterThan(0);
        expect(names.filter((n) => SAVE_LIKE.test(n))).toEqual([]);
        expect(names).not.toContain('agent.save');
        expect(names).not.toContain('agent_save');
      });
});
