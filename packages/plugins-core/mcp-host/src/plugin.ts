import type { PluginContext } from '@harness-x/kernel';
import { openSession } from './host.js';
import { createHarnessMcpServer, type InstallToolsProvider, type ToolsRequestProvider } from './server.js';
import { startMcpHttpServer, type McpHttpServer } from './transports.js';

/**
 * 하네스 플러그인 진입점. config.dir(세션 폴더)가 있으면 활성화 시 streamable HTTP MCP 서버를
 * 루프백에 띄운다(config.port, config.token). 엔진 어댑터는 activeMcpServer()의 url로 접속 설정을 만든다.
 */
let http: McpHttpServer | undefined;
/** T-100 Part 2: 설치 관리자 도구(install.search·resolve·plan) 제공자 — 커널 serve가 연결한다 */
let installProvider: InstallToolsProvider | undefined;

/**
 * 하네스 MCP 서버에 설치 관리자 도구를 붙인다 (undefined면 뗀다).
 * 서버는 접속마다 새로 만들므로 다음 접속부터 반영된다. 실행·제거 도구는 여기로도 노출되지 않는다 (A.7).
 */
export function setInstallToolsProvider(p: InstallToolsProvider | undefined): void {
  installProvider = p;
}

export function installToolsProvider(): InstallToolsProvider | undefined {
  return installProvider;
}

/** T-100 Part 3: 도구 찾기 요청 tools.request 제공자 (ToolNeedHub.mcpProvider()) — 커널 serve가 연결한다 */
let toolsProvider: ToolsRequestProvider | undefined;

export function setToolsRequestProvider(p: ToolsRequestProvider | undefined): void {
  toolsProvider = p;
}

export function toolsRequestProvider(): ToolsRequestProvider | undefined {
  return toolsProvider;
}

/** 지금 연결된 설치·도구 찾기 제공자로 createHarnessMcpServer 옵션 만들기 */
export function harnessMcpExtras(): { install?: InstallToolsProvider; tools?: ToolsRequestProvider } {
  return {
    ...(installProvider ? { install: installProvider } : {}),
    ...(toolsProvider ? { tools: toolsProvider } : {}),
  };
}

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
    createServer: () => createHarnessMcpServer(deps, harnessMcpExtras()),
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
