import { describe, expect, it } from 'vitest';
import {
  claudeMcpArgs,
  claudeMcpConfig,
  claudeMcpEnv,
  codexMcpArgs,
  codexMcpEnv,
  codexMcpToml,
  stdioLaunch,
} from '../src/index.js';

// 23.6 엔진 어댑터가 세션 시작 시 붙이는 설정 생성기 (실제 claude·codex 실행 결과는 티켓에 기록)
describe('23.6 engine MCP config builders', () => {
  const launch = stdioLaunch({
    dir: '/ws/.harness-x/sessions/s1',
    node: 'node',
    bin: '/x/bin.js',
    startupTimeoutSec: 120,
  });

  it('claude --mcp-config (stdio / http)', () => {
    expect(claudeMcpConfig(launch)).toEqual({
      mcpServers: {
        harness: {
          type: 'stdio',
          command: 'node',
          args: ['/x/bin.js', '--dir', '/ws/.harness-x/sessions/s1'],
        },
      },
    });
    expect(claudeMcpConfig({ transport: 'http', url: 'http://127.0.0.1:5/mcp', token: 't' })).toEqual({
      mcpServers: {
        harness: { type: 'http', url: 'http://127.0.0.1:5/mcp', headers: { Authorization: 'Bearer t' } },
      },
    });
    expect(claudeMcpArgs('/tmp/c.json', { strict: true })).toEqual([
      '--mcp-config',
      '/tmp/c.json',
      '--strict-mcp-config',
    ]);
    expect(claudeMcpEnv(launch)).toEqual({ MCP_TIMEOUT: '120000' });
  });

  it('codex -c mcp_servers.* (TOML 값)', () => {
    expect(codexMcpArgs(launch)).toEqual([
      '-c',
      'mcp_servers.harness.command="node"',
      '-c',
      'mcp_servers.harness.args=["/x/bin.js", "--dir", "/ws/.harness-x/sessions/s1"]',
      '-c',
      'mcp_servers.harness.startup_timeout_sec=120',
    ]);
    const http = { transport: 'http', url: 'http://127.0.0.1:5/mcp', token: 'secret' } as const;
    expect(codexMcpArgs(http, 'hx')).toEqual([
      '-c',
      'mcp_servers.hx.url="http://127.0.0.1:5/mcp"',
      '-c',
      'mcp_servers.hx.bearer_token_env_var="HARNESS_MCP_TOKEN"',
    ]);
    expect(codexMcpEnv(http)).toEqual({ HARNESS_MCP_TOKEN: 'secret' });
    expect(codexMcpToml(launch)).toBe(
      '[mcp_servers.harness]\ncommand = "node"\nargs = ["/x/bin.js", "--dir", "/ws/.harness-x/sessions/s1"]\nstartup_timeout_sec = 120\n',
    );
  });
});
