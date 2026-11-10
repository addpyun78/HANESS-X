import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startApiServer } from '../src/api/server.js';
import { PluginLoader } from '../src/loader.js';
import { TRUST_LEVELS, TrustStore } from '../src/sandbox/trust.js';
import { makePlugin } from './plugin-fixtures.js';
import { sandboxSetup } from './sandbox-fixtures.js';

// 실행 위치를 스스로 보고하는 플러그인: 워커에서는 getBuiltinModule이 지워져 있다
const WHERE = `export function activate(ctx) { ctx.log('where ' + (typeof process.getBuiltinModule === 'function' ? 'main' : 'worker')); }`;

describe('62.3 신뢰 등급과 승격', () => {
  it('등급 3종: 코어는 메인, 미서명은 격리', async () => {
    expect(TRUST_LEVELS).toEqual(['core', 'trusted', 'unsigned-isolated']);
    const env = sandboxSetup();
    try {
      const coreRoot = join(env.dir, 'core');
      mkdirSync(coreRoot);
      makePlugin(
        coreRoot,
        { id: 'core-x', version: '1.0.0', apiVersion: 1, provides: { hook: ['x'] } },
        WHERE,
      );
      env.plugin('third', WHERE);
      const loader = new PluginLoader({
        hooks: env.hooks,
        roots: [
          { dir: coreRoot, origin: 'core' },
          { dir: env.userRoot, origin: 'user' },
        ],
        lockFile: env.lockFile,
        logger: (l) => env.lines.push(l),
        sandbox: { trust: new TrustStore(env.trustFile), workspace: env.workspace },
      });
      await loader.loadAll();
      expect(loader.plugins.get('core-x')).toMatchObject({
        trust: 'core',
        isolation: 'main',
        state: 'active',
      });
      expect(loader.plugins.get('third')).toMatchObject({
        trust: 'unsigned-isolated',
        isolation: 'worker',
        state: 'active',
      });
      expect(env.lines).toContain('[core-x] where main');
      expect(env.lines).toContain('[third] where worker');
    } finally {
      env.cleanup();
    }
  });

  it('승격 후 메인 실행, trust.json 유지, 파일이 바뀌면 다시 격리', async () => {
    const env = sandboxSetup();
    try {
      const dir = env.plugin('third', WHERE);
      const loader = env.mkSandboxed();
      await loader.loadAll();
      expect(loader.plugins.get('third')!.isolation).toBe('worker');

      expect(await loader.promote('third')).toBe('trusted');
      expect(loader.plugins.get('third')).toMatchObject({
        trust: 'trusted',
        isolation: 'main',
        state: 'active',
      });
      expect(env.lines.filter((l) => l.startsWith('[third] where'))).toEqual([
        '[third] where worker',
        '[third] where main',
      ]);
      const saved = JSON.parse(readFileSync(env.trustFile, 'utf8')) as { trusted: { id: string }[] };
      expect(saved.trusted.map((t) => t.id)).toEqual(['third']);

      // 새 로더도 trust.json을 보고 바로 메인에서 실행
      const env2Lines = env.lines.length;
      const loader2 = env.mkSandboxed();
      await loader2.loadAll();
      expect(loader2.plugins.get('third')).toMatchObject({ trust: 'trusted', isolation: 'main' });
      expect(env.lines.slice(env2Lines)).toContain('[third] where main');

      // 승격 취소 → 다시 워커
      expect(await loader2.demote('third')).toBe('unsigned-isolated');
      expect(loader2.plugins.get('third')).toMatchObject({ isolation: 'worker', state: 'active' });

      // 승격은 파일 해시에 묶임: 내용이 바뀌면 승격이 풀린다
      await loader2.promote('third');
      appendFileSync(join(dir, 'index.js'), '\n// changed\n');
      const r = await loader2.reload('third');
      expect(r.ok).toBe(true);
      expect(loader2.plugins.get('third')).toMatchObject({ trust: 'unsigned-isolated', isolation: 'worker' });
      expect(env.lines.at(-1)).toBe('[third] where worker');
      await loader2.deactivate('third');
      await loader.deactivate('third');
    } finally {
      env.cleanup();
    }
  });

  it('UI용 API: POST /api/plugins/:id/promote, 목록에 trust·isolation', async () => {
    const env = sandboxSetup();
    try {
      env.plugin('third', WHERE);
      const loader = env.mkSandboxed();
      await loader.loadAll();
      const server = await startApiServer({
        loader,
        log: env.log,
        port: 0,
        tokenFile: join(env.home, 'run', 'token'),
      });
      const auth = { authorization: `Bearer ${server.token}` };
      try {
        const list = (await (await fetch(server.url + '/api/plugins', { headers: auth })).json()) as {
          plugins: { id: string; trust?: string; isolation?: string }[];
        };
        expect(list.plugins).toContainEqual(
          expect.objectContaining({ id: 'third', trust: 'unsigned-isolated', isolation: 'worker' }),
        );
        const res = await fetch(server.url + '/api/plugins/third/promote', { method: 'POST', headers: auth });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          id: 'third',
          trust: 'trusted',
          isolation: 'main',
          state: 'active',
        });
        const missing = await fetch(server.url + '/api/plugins/nope/promote', {
          method: 'POST',
          headers: auth,
        });
        expect(missing.status).toBe(404);
      } finally {
        await server.close();
        await loader.deactivate('third');
      }
    } finally {
      env.cleanup();
    }
  });
});
