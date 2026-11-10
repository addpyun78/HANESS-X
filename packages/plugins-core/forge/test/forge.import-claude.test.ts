import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HookBus, PluginLoader, TrustStore } from '@harness-x/kernel';
import { ImportError, importClaudePlugin } from '../src/import/index.js';

const SAMPLE = fileURLToPath(new URL('./fixtures/claude-plugin', import.meta.url));

async function load(root: string, sandbox: boolean) {
  const hooks = new HookBus();
  const ws = join(root, '..', 'ws');
  mkdirSync(ws, { recursive: true });
  const loader = new PluginLoader({
    hooks,
    roots: [{ dir: root, origin: 'user' }],
    lockFile: join(root, '..', `plugins-${sandbox}.lock`),
    lifecycleTimeoutMs: 20_000,
    ...(sandbox ? { sandbox: { trust: new TrustStore(), workspace: ws } } : {}),
  });
  await loader.loadAll();
  return { hooks, loader };
}

describe('53.2 Claude Code 플러그인(.claude-plugin/plugin.json) → 하네스 매니페스트', () => {
  it('샘플 변환 → 로드 → PreToolUse 훅이 tool.before로 동작 (메인·격리)', { timeout: 120_000 }, async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hx-import-claude-'));
    const root = join(tmp, 'plugins');
    try {
      const r = importClaudePlugin(SAMPLE, join(root, 'safe-shell'));
      expect(r.manifest).toMatchObject({
        id: 'safe-shell',
        version: '1.2.0',
        apiVersion: 1,
        main: 'harness-index.js',
        provides: { command: ['/review'], skill: ['kotlin-style'], hook: ['safe-shell'] },
        permissions: { shell: true },
      });
      expect(r.warnings).toEqual([
        '훅 이벤트 Notification는 하네스에 대응하는 훅이 없어 건너뜀',
        'agents/ 1개는 변환하지 않음 (하네스 에이전트는 agent.yaml)',
      ]);
      // 원본 파일도 함께 복사
      for (const f of [
        'commands/review.md',
        'skills/kotlin-style/SKILL.md',
        'hooks/block-rm.sh',
        '.claude-plugin/plugin.json',
      ])
        expect(existsSync(join(root, 'safe-shell', f)), f).toBe(true);

      for (const sandbox of [false, true]) {
        const { hooks, loader } = await load(root, sandbox);
        try {
          expect(loader.rejections).toEqual([]);
          expect(loader.plugins.get('safe-shell')).toMatchObject({
            state: 'active',
            isolation: sandbox ? 'worker' : 'main',
          });
          const danger = await hooks.runBlocking('tool.before', {
            tool: 'Bash',
            input: { command: 'rm -rf /tmp/x' },
          });
          expect(danger).toMatchObject({ decision: 'block', reason: '위험한 명령 차단: rm -rf' });
          expect(
            (await hooks.runBlocking('tool.before', { tool: 'Bash', input: { command: 'ls' } })).decision,
          ).toBe('allow');
          // matcher(Bash)에 안 맞는 도구는 훅을 돌리지 않는다
          expect(
            (await hooks.runBlocking('tool.before', { tool: 'Read', input: { command: 'rm -rf /' } }))
              .decision,
          ).toBe('allow');
        } finally {
          await loader.deactivate('safe-shell', { force: true });
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('plugin.json 없으면 거부', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hx-import-claude-'));
    try {
      expect(() => importClaudePlugin(tmp, join(tmp, 'out'))).toThrow(ImportError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
