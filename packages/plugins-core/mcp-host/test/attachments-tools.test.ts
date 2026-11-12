import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  AttachmentStore,
  ConversionQueue,
  DEFAULT_CONVERTERS,
  attachmentAgentTools,
  attachmentsProvider,
} from '@harness-x/attachments';
import { runAgentLoop, type ModelClient, type ModelRequest } from '@harness-x/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ATTACHMENTS_MCP_TOOLS,
  HARNESS_TOOLS,
  claudeMcpConfig,
  codexMcpArgs,
  createHarnessMcpServer,
  openSession,
  stdioLaunch,
} from '../src/index.js';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function sessionWithAttachments() {
  const root = mkdtempSync(join(tmpdir(), 'hx-mcp-att-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new AttachmentStore({ projectRoot: root });
  const q = new ConversionQueue({ store, converters: DEFAULT_CONVERTERS });
  const long = Array.from({ length: 3000 }, (_v, i) => `${i}번째 줄`).join('\n');
  const [a, b] = await store.addMany('s-1', [
    { name: '긴메모.txt', data: Buffer.from(long) },
    { name: '화면.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) },
  ]);
  await q.enqueue(a!.attachment);
  await q.enqueue(b!.attachment);
  return { root, dir: store.dir('s-1'), text: long, ids: [a!.attachment.id, b!.attachment.id] };
}

async function mcpClient(dir: string, sessionDir: string, toolNames?: 'dotted' | 'underscore') {
  const server = createHarnessMcpServer(openSession({ dir: sessionDir }), {
    attachments: attachmentsProvider(dir),
    ...(toolNames ? { toolNames } : {}),
  });
  const [x, y] = InMemoryTransport.createLinkedPair();
  await server.connect(x);
  const client = new Client({ name: 'engine', version: '0' });
  await client.connect(y);
  cleanups.push(() => client.close());
  return client;
}

describe('1D.6 MCP attachments.list()·attachments.read(id, form, range) — 모든 엔진 공통', () => {
  it('claude-code(MCP, 점 이름): 도구 목록에 표시 + 부분 읽기', async () => {
    const s = await sessionWithAttachments();
    const client = await mcpClient(s.dir, join(s.root, 'sess'));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([...HARNESS_TOOLS, ...ATTACHMENTS_MCP_TOOLS]));
    // claude 실행 설정은 같은 서버를 --attachments와 함께 띄운다
    const launch = stdioLaunch({ dir: join(s.root, 'sess'), attachmentsDir: s.dir, bin: '/x/bin.js' });
    expect(JSON.stringify(claudeMcpConfig(launch))).toContain('--attachments');

    const list = await client.callTool({ name: 'attachments.list', arguments: {} });
    const atts = (list.structuredContent as { attachments: { id: string; forms: string[] }[] }).attachments;
    expect(atts.map((a) => a.id).sort()).toEqual([...s.ids].sort());
    expect(atts.find((a) => a.id === s.ids[0])!.forms).toEqual(['original', 'text']);

    const r1 = (await client.callTool({ name: 'attachments.read', arguments: { id: s.ids[0], length: 100 } }))
      .structuredContent as { text: string; nextOffset: number; total: number; form: string };
    expect(r1.form).toBe('text');
    expect(r1.text).toBe(s.text.slice(0, 100));
    expect(r1.total).toBe(s.text.length);
    const r2 = (
      await client.callTool({
        name: 'attachments.read',
        arguments: { id: s.ids[0], offset: r1.nextOffset, length: 50 },
      })
    ).structuredContent as { text: string };
    expect(r2.text).toBe(s.text.slice(100, 150));
    const img = (
      await client.callTool({ name: 'attachments.read', arguments: { id: s.ids[1], form: 'original' } })
    ).structuredContent as { base64: string; mime: string };
    expect(img.mime).toBe('image/png');
    expect(Buffer.from(img.base64, 'base64')[1]).toBe(0x50);
    const missing = await client.callTool({
      name: 'attachments.read',
      arguments: { id: 'att_000000000000' },
    });
    expect(missing.isError).toBe(true);
  });

  it('codex(MCP): 실행 인자에 --attachments, 같은 도구 목록 (밑줄 이름 방식도)', async () => {
    const s = await sessionWithAttachments();
    const launch = stdioLaunch({ dir: join(s.root, 'sess'), attachmentsDir: s.dir, bin: '/x/bin.js' });
    expect(codexMcpArgs(launch).join(' ')).toContain('--attachments');
    const client = await mcpClient(s.dir, join(s.root, 'sess2'), 'underscore');
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['attachments_list', 'attachments_read']));
  });

  it('API·로컬 엔진(MCP 없음): 하네스 도구 루프에 attachments_list·attachments_read', async () => {
    const s = await sessionWithAttachments();
    const seen: string[][] = [];
    let calls = 0;
    const client: ModelClient = {
      async complete(req: ModelRequest) {
        seen.push(req.tools.map((t) => t.name));
        calls++;
        if (calls === 1)
          return { text: '', toolCalls: [{ id: 'c1', name: 'attachments_list', arguments: {} }] };
        return { text: '끝', toolCalls: [] };
      },
    };
    const tools = attachmentAgentTools(attachmentsProvider(s.dir));
    expect(tools.map((t) => t.name)).toEqual(['attachments_list', 'attachments_read']);
    const listed = (await tools[0]!.run({}, { cwd: s.root, fileChanged: () => {} })) as {
      attachments: { id: string }[];
    };
    expect(listed.attachments).toHaveLength(2);
    const events = [];
    for await (const e of runAgentLoop({ client, sessionId: 's', cwd: s.root, prompt: '첨부 봐', tools }))
      events.push(e);
    expect(seen[0]).toEqual(['attachments_list', 'attachments_read']);
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
  });
});
