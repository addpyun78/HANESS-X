import type { PluginContext } from '@harness-x/kernel';
import { openSession } from './host.js';
import { createHarnessMcpServer } from './server.js';
import { startMcpHttpServer, type McpHttpServer } from './transports.js';

/**
 * 하네스 플러그인 진입점. config.dir(세션 폴더)가 있으면 활성화 시 streamable HTTP MCP 서버를
 * 루프백에 띄운다(config.port, config.token). 엔진 어댑터는 activeMcpServer()의 url로 접속 설정을 만든다.
 */
let http: McpHttpServer | undefined;

export async function activate(ctx: PluginContext): Promise<void> {
  const dir = typeof ctx.config.dir === 'string' ? ctx.config.dir : undefined;
  if (!dir) {
    ctx.log('mcp-host active (config.dir 없음 — 서버는 어댑터가 stdio로 띄운다)');
    return;
  }
  const deps = openSession({
    dir,
    ...(typeof ctx.config.sessionId === 'string' ? { sessionId: ctx.config.sessionId } : {}),
    ...(typeof ctx.config.glossaryFile === 'string' ? { glossaryFile: ctx.config.glossaryFile } : {}),
  });
  http = await startMcpHttpServer({
    createServer: () => createHarnessMcpServer(deps),
    port: typeof ctx.config.port === 'number' ? ctx.config.port : 0,
    ...(typeof ctx.config.token === 'string' ? { token: ctx.config.token } : {}),
  });
  ctx.log(`mcp-host listening ${http.url}`);
}

export async function deactivate(): Promise<void> {
  await http?.close();
  http = undefined;
}

export function activeMcpServer(): McpHttpServer | undefined {
  return http;
}
