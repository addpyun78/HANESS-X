import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeCodeEngine } from '@harness-x/engine-claude-code';
import { claudeMcpEnv, MCP_SERVER_NAME, stdioLaunch } from '@harness-x/mcp-host';
import { describe, expect, it } from 'vitest';

/**
 * 14.4 실제 1회: claude-code 어댑터 + 하네스 MCP 서버(stdio) → system/init 도구 목록에 체크리스트 도구가 보인다.
 * 구독 사용량을 쓰므로 기본은 건너뛴다. mcp-host가 빌드돼 있어야 한다(dist/bin.js).
 * 실행: HX_REAL_CLAUDE=1 pnpm exec vitest run tests/real-claude-mcp.test.ts
 */
const REAL = process.env.HX_REAL_CLAUDE === '1';
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const BIN = join(root, 'packages/plugins-core/mcp-host/dist/bin.js');

describe.skipIf(!REAL)('14.4 실제 1회: --mcp-config로 하네스 MCP 연결', () => {
  it('init 도구 목록에 mcp__harness__checklist_* 표시', { timeout: 300_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-claude-mcp-'));
    try {
      const launch = stdioLaunch({ dir: join(dir, 'session'), bin: BIN, startupTimeoutSec: 90 });
      if (launch.transport !== 'stdio') throw new Error('stdio expected');
      const run = createClaudeCodeEngine().run({
        sessionId: 'hx-real-mcp',
        cwd: dir,
        permission: 'read-only',
        env: { ...process.env, ...claudeMcpEnv(launch) },
        mcpServers: [{ name: MCP_SERVER_NAME, command: launch.command, args: launch.args ?? [] }],
        prompt: 'Reply with just: ok',
      });
      for await (const e of run.events) void e;
      await run.done;
      const info = run.initInfo();
      const checklist = info.tools.filter((t) => t.startsWith(`mcp__${MCP_SERVER_NAME}__checklist`));
      console.log(JSON.stringify({ mcpServers: info.mcpServers, checklist }));
      expect(info.mcpServers).toContainEqual({ name: MCP_SERVER_NAME, status: 'connected' });
      expect(checklist.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
