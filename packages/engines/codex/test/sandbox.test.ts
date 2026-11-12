// @features F-015
import { describe, expect, it } from 'vitest';
import { buildExecArgs, CODEX_SANDBOX, threadParams } from '../src/args.js';

describe('15.5 sandbox 매핑', () => {
  it('권한 모드 3종 → read-only / workspace-write / danger-full-access', () => {
    expect(CODEX_SANDBOX).toEqual({
      'read-only': 'read-only',
      'workspace-write': 'workspace-write',
      'full-access': 'danger-full-access',
    });
  });

  it.each([
    ['read-only', 'read-only'],
    ['workspace-write', 'workspace-write'],
    ['full-access', 'danger-full-access'],
  ] as const)('%s → exec --sandbox %s, thread/start sandbox %s', (permission, sandbox) => {
    const a = buildExecArgs({ prompt: 'p', cwd: '/w', permission });
    expect(a.slice(a.indexOf('--sandbox'), a.indexOf('--sandbox') + 2)).toEqual(['--sandbox', sandbox]);
    expect(threadParams({ prompt: 'p', cwd: '/w', permission })).toMatchObject({
      sandbox,
      approvalPolicy: 'never',
    });
  });

  it('기본(권한 미지정)은 workspace-write', () => {
    expect(threadParams({ prompt: 'p', cwd: '/w' }).sandbox).toBe('workspace-write');
  });

  it('exec 인자 스냅샷 (모델·resume·MCP)', () => {
    expect(
      buildExecArgs({
        prompt: 'go',
        cwd: '/w',
        permission: 'full-access',
        model: 'gpt-5.5-codex',
        resumeId: '019a-thread',
        mcpServers: [{ name: 'harness', command: 'node', args: ['mcp.js'] }],
      }),
    ).toMatchInlineSnapshot(`
      [
        "exec",
        "--json",
        "--sandbox",
        "danger-full-access",
        "--cd",
        "/w",
        "--skip-git-repo-check",
        "--model",
        "gpt-5.5-codex",
        "-c",
        "mcp_servers.harness.command="node"",
        "-c",
        "mcp_servers.harness.args=["mcp.js"]",
        "resume",
        "019a-thread",
        "--",
        "go",
      ]
    `);
  });
});
