import { fileURLToPath } from 'node:url';
import { MCP_SERVER_NAME } from './server.js';

/**
 * 23.6 엔진 어댑터가 세션 시작 시 하네스 MCP 서버를 붙이는 설정 생성기.
 *  - claude: `claude --mcp-config <파일 또는 JSON 문자열>` 용 { mcpServers: {...} }
 *  - codex:  `codex -c mcp_servers.<name>.<key>=<TOML 값>` 인자 목록 (또는 config.toml 조각)
 */

export type McpLaunch = (
  | {
      /** 엔진이 자식 프로세스로 띄우는 stdio 서버 */
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      /** 이미 떠 있는 streamable HTTP 서버 */
      transport: 'http';
      url: string;
      /** Bearer 토큰 (claude: headers에 직접, codex: 이 이름의 환경 변수에서 읽게 함) */
      token?: string;
      /** codex bearer_token_env_var 이름 (기본 HARNESS_MCP_TOKEN) */
      tokenEnvVar?: string;
    }
) & {
  /**
   * 서버 기동·연결 대기 시간(초). 느린 파일 시스템(WSL /mnt/c)에서는 수십 초 걸릴 수 있다.
   * codex: startup_timeout_sec, claude: MCP_TIMEOUT 환경 변수(claudeMcpEnv)
   */
  startupTimeoutSec?: number;
};

export const DEFAULT_TOKEN_ENV = 'HARNESS_MCP_TOKEN';

/** dist/bin.js 경로 (stdio 실행용). 빌드 전이면 존재하지 않을 수 있다 */
export const MCP_BIN = fileURLToPath(new URL('./bin.js', import.meta.url));

/** stdio 실행 기본값: node <mcp-host>/dist/bin.js --dir <세션 폴더> */
export function stdioLaunch(opts: {
  dir: string;
  sessionId?: string;
  glossaryFile?: string;
  node?: string;
  bin?: string;
  startupTimeoutSec?: number;
}): McpLaunch {
  const args = [opts.bin ?? MCP_BIN, '--dir', opts.dir];
  if (opts.sessionId) args.push('--session', opts.sessionId);
  if (opts.glossaryFile) args.push('--glossary', opts.glossaryFile);
  return {
    transport: 'stdio',
    command: opts.node ?? process.execPath,
    args,
    ...(opts.startupTimeoutSec !== undefined ? { startupTimeoutSec: opts.startupTimeoutSec } : {}),
  };
}

// ── claude ────────────────────────────────────────────────────
export interface ClaudeMcpConfig {
  mcpServers: Record<
    string,
    | { type: 'stdio'; command: string; args: string[]; env?: Record<string, string> }
    | { type: 'http'; url: string; headers?: Record<string, string> }
  >;
}

export function claudeMcpConfig(launch: McpLaunch, name = MCP_SERVER_NAME): ClaudeMcpConfig {
  if (launch.transport === 'stdio')
    return {
      mcpServers: {
        [name]: {
          type: 'stdio',
          command: launch.command,
          args: launch.args ?? [],
          ...(launch.env ? { env: launch.env } : {}),
        },
      },
    };
  return {
    mcpServers: {
      [name]: {
        type: 'http',
        url: launch.url,
        ...(launch.token ? { headers: { Authorization: `Bearer ${launch.token}` } } : {}),
      },
    },
  };
}

/** claude CLI 인자: --mcp-config <file|json> [--strict-mcp-config] */
export function claudeMcpArgs(configFileOrJson: string, opts: { strict?: boolean } = {}): string[] {
  return ['--mcp-config', configFileOrJson, ...(opts.strict ? ['--strict-mcp-config'] : [])];
}

/** claude 실행 시 함께 넘길 환경 변수 (MCP 서버 연결 대기 ms) */
export function claudeMcpEnv(launch: McpLaunch): Record<string, string> {
  return launch.startupTimeoutSec !== undefined
    ? { MCP_TIMEOUT: String(Math.ceil(launch.startupTimeoutSec * 1000)) }
    : {};
}

// ── codex ─────────────────────────────────────────────────────
/** TOML 값 (문자열·문자열 배열·인라인 테이블). JSON 문자열 이스케이프는 TOML 기본 문자열과 호환 */
function toml(v: string | string[] | Record<string, string>): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((s) => JSON.stringify(s)).join(', ')}]`;
  return `{ ${Object.entries(v)
    .map(([k, s]) => `${JSON.stringify(k)} = ${JSON.stringify(s)}`)
    .join(', ')} }`;
}

function codexEntries(launch: McpLaunch): [string, string][] {
  const out: [string, string][] = [];
  if (launch.transport === 'stdio') {
    out.push(['command', toml(launch.command)], ['args', toml(launch.args ?? [])]);
    if (launch.env) out.push(['env', toml(launch.env)]);
  } else {
    out.push(['url', toml(launch.url)]);
    if (launch.token) out.push(['bearer_token_env_var', toml(launch.tokenEnvVar ?? DEFAULT_TOKEN_ENV)]);
  }
  if (launch.startupTimeoutSec !== undefined)
    out.push(['startup_timeout_sec', String(Math.ceil(launch.startupTimeoutSec))]);
  return out;
}

/** codex CLI 인자: -c mcp_servers.<name>.command=... -c mcp_servers.<name>.args=[...] */
export function codexMcpArgs(launch: McpLaunch, name = MCP_SERVER_NAME): string[] {
  return codexEntries(launch).flatMap(([k, v]) => ['-c', `mcp_servers.${name}.${k}=${v}`]);
}

/** codex 실행 시 함께 넘길 환경 변수 (http + token이면 토큰) */
export function codexMcpEnv(launch: McpLaunch): Record<string, string> {
  return launch.transport === 'http' && launch.token
    ? { [launch.tokenEnvVar ?? DEFAULT_TOKEN_ENV]: launch.token }
    : {};
}

/** ~/.codex/config.toml 조각 */
export function codexMcpToml(launch: McpLaunch, name = MCP_SERVER_NAME): string {
  return [`[mcp_servers.${name}]`, ...codexEntries(launch).map(([k, v]) => `${k} = ${v}`)].join('\n') + '\n';
}
