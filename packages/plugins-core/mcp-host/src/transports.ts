import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Readable, Writable } from 'node:stream';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

/**
 * 23.1 전송: stdio(엔진 CLI가 자식 프로세스로 띄움) + streamable HTTP(루프백, 세션별 McpServer).
 */

/** stdio로 연결 (기본 프로세스 stdin/stdout, 테스트는 스트림 주입). 반환: 닫기 함수 */
export async function serveStdio(
  server: McpServer,
  io: { stdin?: Readable; stdout?: Writable } = {},
): Promise<() => Promise<void>> {
  const transport = new StdioServerTransport(io.stdin, io.stdout);
  await server.connect(transport);
  return () => server.close();
}

export const MCP_HTTP_PATH = '/mcp';
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];

export interface McpHttpOptions {
  /** 세션마다 새 McpServer를 만든다 (McpServer 하나는 전송 하나에만 연결된다) */
  createServer: () => McpServer;
  host?: string;
  /** 0 = 임의 */
  port?: number;
  path?: string;
  /** 주면 Authorization: Bearer <token> 필수 */
  token?: string;
}

export interface McpHttpServer {
  url: string;
  port: number;
  http: Server;
  /** 열린 MCP 세션 수 */
  sessions(): number;
  close(): Promise<void>;
}

export async function startMcpHttpServer(opts: McpHttpOptions): Promise<McpHttpServer> {
  const host = opts.host ?? '127.0.0.1';
  if (!LOOPBACK.includes(host)) throw new Error(`MCP HTTP는 루프백에만 바인딩합니다: ${host}`);
  const path = opts.path ?? MCP_HTTP_PATH;
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== path) return send(res, 404, { error: 'not_found' });
    if (opts.token && !checkBearer(req.headers.authorization, opts.token))
      return send(res, 401, { error: 'unauthorized' });
    const sid = header(req, 'mcp-session-id');
    let body: unknown;
    if (req.method === 'POST') {
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, rpcError('Parse error', -32700));
      }
    }
    const existing = sid ? sessions.get(sid) : undefined;
    if (existing) return existing.transport.handleRequest(req, res, body);
    if (req.method === 'POST' && !sid && isInit(body)) {
      const server = opts.createServer();
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      return transport.handleRequest(req, res, body);
    }
    return send(res, 400, rpcError('Bad Request: 세션 ID가 없거나 잘못되었습니다', -32000));
  };

  const http = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent)
        send(res, 500, rpcError(err instanceof Error ? err.message : String(err), -32603));
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port ?? 0, host, () => resolve());
  });
  const port = (http.address() as AddressInfo).port;
  const h = host.includes(':') ? `[${host}]` : host;
  return {
    url: `http://${h}:${port}${path}`,
    port,
    http,
    sessions: () => sessions.size,
    close: async () => {
      for (const s of [...sessions.values()]) await s.server.close().catch(() => {});
      sessions.clear();
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

function isInit(body: unknown): boolean {
  return Array.isArray(body) ? body.some((m) => isInitializeRequest(m)) : isInitializeRequest(body);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function checkBearer(auth: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(auth ?? '');
  if (!m) return false;
  const a = Buffer.from(m[1]!.trim());
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const s = Buffer.concat(chunks).toString('utf8');
        resolve(s ? JSON.parse(s) : undefined);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    req.on('error', reject);
  });
}

function rpcError(message: string, code: number) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
