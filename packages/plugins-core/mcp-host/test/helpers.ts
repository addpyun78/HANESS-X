import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { ChecklistItemInput } from '@harness-x/checklist-ledger';
import { createHarnessMcpServer, openSession, serveStdio, startMcpHttpServer } from '../src/index.js';

export function tempDir(prefix = 'hx-mcp-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function item(id: string, extra: Partial<ChecklistItemInput> = {}): ChecklistItemInput {
  return {
    id,
    title: `항목 ${id} 구현`,
    artifactId: `art.item-${id.replace(/\./g, '-')}`,
    acceptance: [{ type: 'test', run: `pnpm test item-${id}` }],
    ...extra,
  };
}

/** 클라이언트 쪽 stdio 전송 (스트림 쌍 위에서 줄 단위 JSON-RPC) — 자식 프로세스 대신 메모리 파이프 */
class StreamClientTransport implements Transport {
  onmessage?: (m: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (e: Error) => void;
  private buf = new ReadBuffer();
  constructor(
    private readonly input: PassThrough,
    private readonly output: PassThrough,
  ) {}
  async start(): Promise<void> {
    this.input.on('data', (c: Buffer) => {
      this.buf.append(c);
      for (let m = this.buf.readMessage(); m; m = this.buf.readMessage()) this.onmessage?.(m);
    });
  }
  async send(m: JSONRPCMessage): Promise<void> {
    this.output.write(serializeMessage(m));
  }
  async close(): Promise<void> {
    this.onclose?.();
  }
}

export interface Connected {
  client: Client;
  deps: ReturnType<typeof openSession>;
  close(): Promise<void>;
}

/** stdio 전송으로 연결된 클라이언트 */
export async function connectStdio(dir: string): Promise<Connected> {
  const deps = openSession({ dir });
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const stop = await serveStdio(createHarnessMcpServer(deps), { stdin: toServer, stdout: toClient });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(new StreamClientTransport(toClient, toServer));
  return {
    client,
    deps,
    close: async () => {
      await client.close();
      await stop();
    },
  };
}

/** streamable HTTP 전송으로 연결된 클라이언트 */
export async function connectHttp(dir: string, token?: string): Promise<Connected & { url: string }> {
  const deps = openSession({ dir });
  const srv = await startMcpHttpServer({
    createServer: () => createHarnessMcpServer(deps),
    ...(token ? { token } : {}),
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(srv.url), {
      ...(token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : {}),
    }),
  );
  return {
    client,
    deps,
    url: srv.url,
    close: async () => {
      await client.close();
      await srv.close();
    },
  };
}

/** 도구 호출 → JSON 결과 */
export async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; body: Record<string, unknown> }> {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])[0]!.text;
  return { isError: r.isError === true, body: JSON.parse(text) as Record<string, unknown> };
}
