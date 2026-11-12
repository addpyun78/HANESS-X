import type { McpServerRef, PermissionMode, RunMode } from '@harness-x/protocol';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/** 15.5 하네스 권한 모드 → codex sandbox */
export const CODEX_SANDBOX: Record<PermissionMode, CodexSandboxMode> = {
  'read-only': 'read-only',
  'workspace-write': 'workspace-write',
  'full-access': 'danger-full-access',
};

/**
 * T-101 실행 모드가 권한보다 먼저다.
 *  3B.3 계획 → read-only
 *  3D.6 오토 → workspace-write + 승인 묻지 않음(--ask-for-approval never, codex 최상위 옵션이라 exec 앞에)
 */
export function codexSandbox(permission: PermissionMode | undefined, mode?: RunMode): CodexSandboxMode {
  if (mode === 'plan') return 'read-only';
  // 3D.6 오토 → workspace-write (danger-full-access 금지) — 최종 판단은 하네스 게이트
  if (mode === 'auto') return 'workspace-write';
  return CODEX_SANDBOX[permission ?? 'workspace-write'];
}

/** McpServerRef[] → codex config의 mcp_servers 테이블 */
export function codexMcpServers(servers: McpServerRef[] = []): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const s of servers) {
    if (s.url) out[s.name] = { url: s.url, ...(s.headers ? { http_headers: s.headers } : {}) };
    else if (s.command)
      out[s.name] = { command: s.command, args: s.args ?? [], ...(s.env ? { env: s.env } : {}) };
    else throw new Error(`MCP 서버 ${s.name}: command 또는 url이 필요합니다`);
  }
  return out;
}

export interface CodexRunInput {
  prompt: string;
  cwd: string;
  model?: string;
  permission?: PermissionMode;
  mode?: RunMode;
  resumeId?: string;
  mcpServers?: McpServerRef[];
  /** T-101 1D.3 그림 직접 입력 (exec --image / app-server localImage) */
  images?: string[];
}

/** app-server thread/start · thread/resume 파라미터 (승인은 묻지 않음: 샌드박스가 경계) */
export function threadParams(input: CodexRunInput): Record<string, unknown> {
  const mcp = codexMcpServers(input.mcpServers);
  return {
    ...(input.resumeId ? { threadId: input.resumeId } : {}),
    cwd: input.cwd,
    sandbox: codexSandbox(input.permission, input.mode),
    approvalPolicy: 'never',
    ...(input.model ? { model: input.model } : {}),
    ...(Object.keys(mcp).length ? { config: { mcp_servers: mcp } } : {}),
  };
}

/** TOML 값으로 쓸 수 있는 JSON (문자열·배열·인라인 테이블) */
function toToml(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(toToml).join(', ')}]`;
  if (v && typeof v === 'object')
    return `{ ${Object.entries(v)
      .map(([k, x]) => `${JSON.stringify(k)} = ${toToml(x)}`)
      .join(', ')} }`;
  return JSON.stringify(v);
}

/**
 * 15.4 폴백: codex exec --json 인자
 * 옵션은 resume 서브커맨드 앞에 두고, 프롬프트는 `--` 뒤 마지막 인자
 */
export function buildExecArgs(input: CodexRunInput): string[] {
  const args = [
    ...(input.mode === 'auto' ? ['--ask-for-approval', 'never'] : []),
    'exec',
    '--json',
    '--sandbox',
    codexSandbox(input.permission, input.mode),
    '--cd',
    input.cwd,
  ];
  args.push('--skip-git-repo-check');
  if (input.model) args.push('--model', input.model);
  for (const [name, cfg] of Object.entries(codexMcpServers(input.mcpServers)))
    for (const [k, v] of Object.entries(cfg)) args.push('-c', `mcp_servers.${name}.${k}=${toToml(v)}`);
  for (const img of input.images ?? []) args.push('--image', img);
  if (input.resumeId) args.push('resume', input.resumeId);
  args.push('--', input.prompt);
  return args;
}

export const APP_SERVER_ARGS = ['app-server'];

/** T-101 1D.3 app-server turn/start 입력: 글 + 그림(localImage) */
export function turnInput(input: Pick<CodexRunInput, 'prompt' | 'images'>): Record<string, unknown>[] {
  return [
    { type: 'text', text: input.prompt, text_elements: [] },
    ...(input.images ?? []).map((path) => ({ type: 'localImage', path })),
  ];
}
