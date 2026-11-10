import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EventLog, HookBus, PluginLoader, startApiServer } from '@harness-x/kernel';
import { ImportError, importMcpConfig, listMcpTools, readMcpConfig } from '../src/import/index.js';

const ECHO = fileURLToPath(new URL('./fixtures/echo-mcp-server.mjs', import.meta.url));

describe('53.4 MCP 서버 설정 가져오기 (tool 슬롯으로 래핑)', () => {
  it('.mcp.json → tool 슬롯 플러그인 → 로드, 도구 목록 표시', { timeout: 120_000 }, async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hx-import-mcp-'));
    const log = new EventLog({ root: join(tmp, 'logs') });
    try {
      const cfgFile = join(tmp, '.mcp.json');
      writeFileSync(
        cfgFile,
        JSON.stringify({
          mcpServers: {
            echo: { command: process.execPath, args: [ECHO], env: { ECHO_MODE: '1' } },
            'Remote Docs': { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } },
          },
        }),
      );
      const servers = readMcpConfig(JSON.parse(readFileSync(cfgFile, 'utf8')));
      expect(servers.map((s) => s.name)).toEqual(['echo', 'remote-docs']);

      // 도구 목록: stdio 서버에 실제로 접속해 tools/list
      const tools = await listMcpTools(servers.filter((s) => s.command));
      expect(tools).toEqual([
        {
          server: 'echo',
          tools: [
            { name: 'echo', description: '받은 글을 그대로 돌려준다' },
            { name: 'word_count', description: '낱말 수를 센다' },
          ],
        },
      ]);

      const root = join(tmp, 'plugins');
      const r = importMcpConfig(cfgFile, join(root, 'mcp-servers'), { tools });
      expect(r.manifest).toMatchObject({
        id: 'mcp-servers',
        provides: { tool: ['echo', 'remote-docs'] },
        permissions: { fs: [], net: ['mcp.example.com'], shell: true },
      });

      const loader = new PluginLoader({
        hooks: new HookBus({ log }),
        log,
        roots: [{ dir: root, origin: 'user' }],
        lockFile: join(tmp, 'plugins.lock'),
      });
      expect(await loader.loadAll()).toEqual(['mcp-servers']);
      const mod = loader.plugins.get('mcp-servers')!.module as { mcpServers?: unknown; tools?: unknown };
      expect(mod.mcpServers).toEqual(servers);
      expect(mod.tools).toEqual(tools);

      // GET /api/plugins: tool 슬롯과 서버 이름이 보인다
      const server = await startApiServer({ loader, log, port: 0, tokenFile: join(tmp, 'run', 'token') });
      try {
        const res = (await (
          await fetch(`${server.url}/api/plugins`, { headers: { authorization: `Bearer ${server.token}` } })
        ).json()) as { plugins: { id: string; slots: string[]; provides: { tool?: string[] } }[] };
        expect(res.plugins.find((p) => p.id === 'mcp-servers')).toMatchObject({
          slots: ['tool'],
          provides: { tool: ['echo', 'remote-docs'] },
        });
      } finally {
        await server.close();
      }
    } finally {
      log.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('접속 실패 서버는 error, 서버 없는 설정은 거부', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hx-import-mcp-'));
    try {
      const [bad] = await listMcpTools(
        [{ name: 'broken', command: process.execPath, args: ['-e', 'process.exit(3)'] }],
        {
          timeoutMs: 10_000,
        },
      );
      expect(bad).toMatchObject({ server: 'broken', tools: [], error: expect.any(String) });
      expect(() => importMcpConfig({ mcpServers: {} }, join(tmp, 'x'))).toThrow(ImportError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
