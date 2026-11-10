import type { McpServerRef } from '@harness-x/protocol';
import { kebab } from './common.js';

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
