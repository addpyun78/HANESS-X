import type { McpServerRef, PermissionMode, RunMode } from '@harness-x/protocol';

/** 하네스 권한 모드 → claude --permission-mode */
export const CLAUDE_PERMISSION_MODES: Record<PermissionMode, string> = {
  'read-only': 'plan',
  'workspace-write': 'acceptEdits',
  'full-access': 'bypassPermissions',
};

/**
 * T-101 실행 모드 → claude --permission-mode. 모드가 권한보다 먼저다.
 *  3B.3 계획 → plan (읽기만)
 *  3D.6 오토 → acceptEdits (권한이 '전체'여도 bypassPermissions 금지)
 */
export function claudePermissionMode(permission: PermissionMode | undefined, mode?: RunMode): string {
  if (mode === 'plan') return 'plan';
  // 3D.6 오토 → acceptEdits. 전체 우회(bypassPermissions)는 오토에서 절대 쓰지 않는다 — 최종 판단은 하네스 게이트
  if (mode === 'auto') return 'acceptEdits';
  return CLAUDE_PERMISSION_MODES[permission ?? 'workspace-write'];
}

export interface ClaudeArgsInput {
  prompt: string;
  model?: string;
  permission?: PermissionMode;
  mode?: RunMode;
  resumeId?: string;
  mcpServers?: McpServerRef[];
}

/** McpServerRef[] → claude --mcp-config JSON ({"mcpServers": {...}}) */
export function buildMcpConfig(servers: McpServerRef[]): string {
  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    if (s.url) {
      mcpServers[s.name] = { type: 'http', url: s.url, ...(s.headers ? { headers: s.headers } : {}) };
    } else if (s.command) {
      mcpServers[s.name] = {
        type: 'stdio',
        command: s.command,
        args: s.args ?? [],
        ...(s.env ? { env: s.env } : {}),
      };
    } else {
      throw new Error(`MCP 서버 ${s.name}: command 또는 url이 필요합니다`);
    }
  }
  return JSON.stringify({ mcpServers });
}

/**
 * 14.1 claude 실행 인자: -p --output-format stream-json --verbose --permission-mode <모드> --model <모델>
 * 프롬프트는 `--` 뒤 마지막 인자 (- 로 시작해도 옵션으로 오인되지 않게)
 */
export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  args.push('--permission-mode', claudePermissionMode(input.permission, input.mode));
  if (input.model) args.push('--model', input.model);
  if (input.resumeId) args.push('--resume', input.resumeId);
  if (input.mcpServers?.length) args.push('--mcp-config', buildMcpConfig(input.mcpServers));
  args.push('--', input.prompt);
  return args;
}
