import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, CLAUDE_PERMISSION_MODES } from '../src/args.js';

describe('14.1 claude 실행 인자 빌더', () => {
  it('기본 인자 스냅샷', () => {
    expect(buildClaudeArgs({ prompt: 'hello' })).toMatchInlineSnapshot(`
      [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "acceptEdits",
        "--",
        "hello",
      ]
    `);
  });

  it('모델·권한 모드 스냅샷', () => {
    expect(buildClaudeArgs({ prompt: '-dash prompt', model: 'sonnet', permission: 'read-only' }))
      .toMatchInlineSnapshot(`
        [
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode",
          "plan",
          "--model",
          "sonnet",
          "--",
          "-dash prompt",
        ]
      `);
  });

  it('권한 모드 매핑 3종', () => {
    expect(CLAUDE_PERMISSION_MODES).toEqual({
      'read-only': 'plan',
      'workspace-write': 'acceptEdits',
      'full-access': 'bypassPermissions',
    });
    const mode = (p: 'read-only' | 'workspace-write' | 'full-access') => {
      const a = buildClaudeArgs({ prompt: 'x', permission: p });
      return a[a.indexOf('--permission-mode') + 1];
    };
    expect([mode('read-only'), mode('workspace-write'), mode('full-access')]).toEqual([
      'plan',
      'acceptEdits',
      'bypassPermissions',
    ]);
  });

  it('프롬프트는 -- 뒤 마지막 인자', () => {
    const a = buildClaudeArgs({ prompt: 'p', model: 'm', resumeId: 's1' });
    expect(a.at(-2)).toBe('--');
    expect(a.at(-1)).toBe('p');
  });

  it('14.4 mcpServers → --mcp-config JSON 스냅샷 (stdio·http), -- 앞에 위치', () => {
    const a = buildClaudeArgs({
      prompt: 'p',
      mcpServers: [
        { name: 'harness', command: 'node', args: ['mcp.js', '--stdio'], env: { HX_SESSION: 's1' } },
        { name: 'harness-http', url: 'http://127.0.0.1:4000/mcp', headers: { authorization: 'Bearer t' } },
      ],
    });
    const i = a.indexOf('--mcp-config');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(a.indexOf('--'));
    expect(JSON.parse(a[i + 1]!)).toMatchInlineSnapshot(`
      {
        "mcpServers": {
          "harness": {
            "args": [
              "mcp.js",
              "--stdio",
            ],
            "command": "node",
            "env": {
              "HX_SESSION": "s1",
            },
            "type": "stdio",
          },
          "harness-http": {
            "headers": {
              "authorization": "Bearer t",
            },
            "type": "http",
            "url": "http://127.0.0.1:4000/mcp",
          },
        },
      }
    `);
    expect(buildClaudeArgs({ prompt: 'p', mcpServers: [] })).not.toContain('--mcp-config');
    expect(() => buildClaudeArgs({ prompt: 'p', mcpServers: [{ name: 'bad' }] })).toThrow(/command 또는 url/);
  });

  it('resumeId → --resume <id>', () => {
    const a = buildClaudeArgs({ prompt: 'p', resumeId: 'f324fe3a-ef4b-4947-9fd3-3efa529054fa' });
    expect(a.slice(a.indexOf('--resume'), a.indexOf('--resume') + 2)).toEqual([
      '--resume',
      'f324fe3a-ef4b-4947-9fd3-3efa529054fa',
    ]);
    expect(buildClaudeArgs({ prompt: 'p' })).not.toContain('--resume');
  });
});
