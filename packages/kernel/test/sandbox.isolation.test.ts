import { describe, expect, it } from 'vitest';
import { sandboxSetup } from './sandbox-fixtures.js';

describe('62.1 서드파티 플러그인 worker_threads 격리', () => {
  it('직접 fs 접근(정적 import) 시 activate 실패', async () => {
    const env = sandboxSetup();
    try {
      env.plugin(
        'evil-static',
        `import fs from 'node:fs';\nexport function activate(){ fs.writeFileSync('/tmp/x', 'x'); }`,
      );
      const loader = env.mkSandboxed();
      await loader.loadAll();
      const p = loader.plugins.get('evil-static')!;
      expect(p).toMatchObject({ state: 'failed', trust: 'unsigned-isolated', isolation: 'worker' });
      expect(p.error).toMatch(/sandbox: 직접 접근 금지 \(node:fs\)/);
    } finally {
      env.cleanup();
    }
  });

  it('동적 import·getBuiltinModule·require·child_process·CommonJS 우회도 실패, 메시지 RPC 훅은 동작', async () => {
    const env = sandboxSetup();
    try {
      env.plugin(
        'probe',
        `
export async function activate(ctx) {
  const results = {};
  for (const spec of ['fs', 'node:fs/promises', 'child_process', 'node:net', 'node:module', 'node:vm', 'node:worker_threads']) {
    try { await import(spec); results[spec] = 'loaded'; } catch (e) { results[spec] = e.code; }
  }
  results.getBuiltinModule = typeof process.getBuiltinModule;
  results.require = typeof globalThis.require;
  results.env = Object.keys(process.env).length;
  try { await import('data:text/javascript,import fs from "fs"; export default fs'); results.dataUrl = 'loaded'; }
  catch (e) { results.dataUrl = e.code; }
  results.path = (await import('node:path')).join('a', 'b');
  ctx.log(JSON.stringify(results));
  ctx.hooks.onBlocking('tool.before', (c) => c.tool === 'rm' ? { decision: 'deny', reason: 'no rm from worker' } : undefined);
}`,
      );
      const loader = env.mkSandboxed();
      await loader.loadAll();
      expect(loader.plugins.get('probe')).toMatchObject({ state: 'active', isolation: 'worker' });
      const line = env.lines.find((l) => l.startsWith('[probe] {'))!;
      const r = JSON.parse(line.slice('[probe] '.length)) as Record<string, unknown>;
      expect(r).toEqual({
        fs: 'ERR_SANDBOX_DENIED',
        'node:fs/promises': 'ERR_SANDBOX_DENIED',
        child_process: 'ERR_SANDBOX_DENIED',
        'node:net': 'ERR_SANDBOX_DENIED',
        'node:module': 'ERR_SANDBOX_DENIED',
        'node:vm': 'ERR_SANDBOX_DENIED',
        'node:worker_threads': 'ERR_SANDBOX_DENIED',
        getBuiltinModule: 'undefined',
        require: 'undefined',
        env: 0,
        dataUrl: 'ERR_SANDBOX_DENIED',
        path: 'a/b',
      });
      // 워커 훅이 메인 훅 버스에서 RPC로 동작
      expect((await env.hooks.runBlocking('tool.before', { tool: 'rm' })).decision).toBe('deny');
      expect((await env.hooks.runBlocking('tool.before', { tool: 'ls' })).decision).toBe('allow');
      // deactivate → 워커 종료, 훅 해제
      await loader.deactivate('probe');
      expect((await env.hooks.runBlocking('tool.before', { tool: 'rm' })).decision).toBe('allow');
    } finally {
      env.cleanup();
    }
  });

  it('sandbox 옵션이 없으면 기존처럼 메인 스레드 실행', async () => {
    const env = sandboxSetup();
    try {
      env.plugin(
        'plain',
        `import fs from 'node:fs';\nexport function activate(ctx){ ctx.log('fs ' + typeof fs.readFileSync); }`,
      );
      const loader = env.mk();
      const order = await loader.loadAll();
      expect(order).toContain('plain');
      expect(loader.plugins.get('plain')!.trust).toBeUndefined();
    } finally {
      env.cleanup();
    }
  });
});
