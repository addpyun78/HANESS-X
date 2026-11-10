import { existsSync, readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerRef } from '@harness-x/protocol';
import { ImportError, js, kebab, prepareDest, writePlugin, type ImportResult } from './common.js';

/**
 * MCP 서버 설정 읽기
 * 받는 형식: { mcpServers: { <이름>: { command, args?, env? } | { url, headers? } } } (Claude Code .mcp.json·데스크톱 설정)
 *           또는 그 안쪽 맵 그대로
 */
export function readMcpConfig(raw: unknown): McpServerRef[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const map = (
    typeof obj.mcpServers === 'object' && obj.mcpServers !== null ? obj.mcpServers : obj
  ) as Record<string, unknown>;
  const out: McpServerRef[] = [];
  for (const [rawName, v] of Object.entries(map)) {
    if (!v || typeof v !== 'object') continue;
    const s = v as Record<string, unknown>;
    const name = kebab(rawName);
    if (!name) continue;
    const strs = (x: unknown) =>
      Array.isArray(x) ? x.filter((a): a is string => typeof a === 'string') : undefined;
    const rec = (x: unknown) =>
      x && typeof x === 'object'
        ? Object.fromEntries(Object.entries(x).filter((e): e is [string, string] => typeof e[1] === 'string'))
        : undefined;
    if (typeof s.command === 'string') {
      const args = strs(s.args);
      const env = rec(s.env);
      out.push({ name, command: s.command, ...(args?.length ? { args } : {}), ...(env ? { env } : {}) });
    } else if (typeof s.url === 'string') {
      const headers = rec(s.headers);
      out.push({ name, url: s.url, ...(headers ? { headers } : {}) });
    }
  }
  return out;
}

/**
 * T-053 53.4 MCP 서버 설정 가져오기 → tool 슬롯 플러그인
 * 서버마다 provides.tool 항목 하나. 진입 모듈은 mcpServers(McpServerRef[])를 내보낸다 — 엔진 세션에 붙이는 쪽이 쓴다.
 * 권한: stdio 서버는 프로세스를 띄우므로 shell, URL 서버는 그 호스트를 net에 선언한다(설치 카드에서 빨간 경고).
 */
export function mcpPluginMain(servers: McpServerRef[], tools: McpToolList[] = []): string {
  return `// 생성됨: Forge 가져오기 (MCP 서버 설정 → 하네스 tool 슬롯)
export const mcpServers = ${js(servers)};
/** 가져올 때 확인한 도구 목록 (서버별) */
export const tools = ${js(tools)};

export function activate(ctx) {
  ctx.log('mcp tools: ' + mcpServers.map((s) => s.name).join(', '));
}

export function deactivate() {}
`;
}

export interface McpToolList {
  server: string;
  tools: { name: string; description?: string }[];
  error?: string;
}

export function importMcpConfig(
  config: unknown,
  dest: string,
  opts: { id?: string; tools?: McpToolList[] } = {},
): ImportResult {
  let raw = config;
  if (typeof config === 'string') {
    if (!existsSync(config)) throw new ImportError(`MCP 설정 파일 없음: ${config}`);
    raw = JSON.parse(readFileSync(config, 'utf8')) as unknown;
  }
  const servers = readMcpConfig(raw);
  if (!servers.length) throw new ImportError('MCP 서버 설정이 없음 (mcpServers)');
  const hosts = servers.flatMap((s) => {
    if (!s.url) return [];
    try {
      return [new URL(s.url).hostname];
    } catch {
      return [];
    }
  });
  const warnings = servers
    .filter((s) => s.url && !/^https?:/.test(s.url))
    .map((s) => `${s.name}: 지원하지 않는 URL ${s.url}`);
  prepareDest(undefined, dest);
  const id = opts.id ?? (servers.length === 1 ? `mcp-${servers[0]!.name}` : 'mcp-servers');
  const manifest = writePlugin(
    dest,
    {
      id,
      version: '0.1.0',
      apiVersion: 1,
      displayName: `MCP: ${servers.map((s) => s.name).join(', ')}`,
      description: 'MCP 서버 설정을 가져와 tool 슬롯으로 감싼 플러그인',
      provides: { tool: servers.map((s) => s.name) },
      permissions: {
        fs: [],
        // 127.0.0.1·localhost 같은 루프백은 도메인 형식이 아니므로 net 선언에서 뺀다
        net: [...new Set(hosts.filter((h) => /\.[a-z]/i.test(h) && !/^\d+(\.\d+){3}$/.test(h)))],
        shell: servers.some((s) => !!s.command),
      },
    },
    mcpPluginMain(servers, opts.tools ?? []),
  );
  return { dir: dest, manifest, warnings };
}

/** 서버마다 접속해 도구 목록을 받는다 (실패한 서버는 error) */
export async function listMcpTools(
  servers: McpServerRef[],
  opts: { timeoutMs?: number; cwd?: string } = {},
): Promise<McpToolList[]> {
  const out: McpToolList[] = [];
  for (const s of servers) {
    const client = new Client({ name: 'harness-forge-import', version: '0.1.0' });
    try {
      const transport = s.command
        ? new StdioClientTransport({
            command: s.command,
            args: s.args ?? [],
            env: { ...getDefaultEnvironment(), ...(s.env ?? {}) },
            stderr: 'ignore',
            ...(opts.cwd ? { cwd: opts.cwd } : {}),
          })
        : new StreamableHTTPClientTransport(new URL(s.url!), {
            ...(s.headers ? { requestInit: { headers: s.headers } } : {}),
          });
      await client.connect(transport, { timeout: opts.timeoutMs ?? 20_000 });
      const r = await client.listTools(undefined, { timeout: opts.timeoutMs ?? 20_000 });
      out.push({
        server: s.name,
        tools: r.tools.map((t) => ({
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
        })),
      });
    } catch (err) {
      out.push({ server: s.name, tools: [], error: err instanceof Error ? err.message : String(err) });
    } finally {
      await client.close().catch(() => {});
    }
  }
  return out;
}
