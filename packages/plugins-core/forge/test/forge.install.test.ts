import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HookBus, PluginLoader, TrustStore, defaultPluginRoots, startApiServer } from '@harness-x/kernel';
import { compilePlugin } from '../src/check.js';
import { createForge } from '../src/forge.js';
import { forgeInstallDir, installPlugin } from '../src/install.js';
import { applyFiles, scaffoldFromSpec } from '../src/scaffold.js';
import { KOTLIN_HOOK_OK } from './fixtures/kotlin-hook.js';
import { KOTLIN_REQ, kotlinSpec } from './fixtures/plugins.js';
import { autoAnswer, collect, forgeEnv } from './helpers.js';

const gitLog = (dir: string) =>
  execFileSync('git', ['log', '--format=%s'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');

describe('52.5 설치: ~/.harness-x/plugins/forge/<id>/ Git 저장소, 등급 "미서명·격리"', () => {
  let env: ReturnType<typeof forgeEnv>;
  const saved = process.env.HARNESS_X_HOME;
  afterEach(() => {
    if (saved === undefined) delete process.env.HARNESS_X_HOME;
    else process.env.HARNESS_X_HOME = saved;
    env.cleanup();
  });

  it('install 노드: 설치 카드(등급 표시) → 승인 → HARNESS_X_HOME/plugins/forge/<id> Git 저장소', async () => {
    env = forgeEnv();
    process.env.HARNESS_X_HOME = env.home;
    const forge = createForge({ broker: env.broker, log: env.log });
    const auto = autoAnswer(env.broker);
    const opts = forge.runnerOptions({ sessionId: 's-inst', request: KOTLIN_REQ, workspace: env.workspace });
    const s = forge.session('s-inst')!;
    s.spec = kotlinSpec();
    scaffoldFromSpec(s.spec, s.pluginDir);
    applyFiles(s.pluginDir, { 'src/index.ts': KOTLIN_HOOK_OK });
    expect(compilePlugin(s.pluginDir, { emit: true }).ok).toBe(true);

    const events = await collect(
      opts
        .engines('forge')
        .run({ sessionId: 's-inst', prompt: '', cwd: env.workspace, env: { HARNESS_X_NODE: 'install' } }),
    );
    auto.stop();
    const card = auto.cards.find((c) => c.kind === 'forge_install')!;
    expect(card.detail).toMatchObject({
      id: 'pr-kotlin-guard',
      trust: 'unsigned-isolated',
      trustLabel: '미서명·격리',
      warnings: [{ kind: 'shell', level: 'danger' }],
    });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });

    const dir = forgeInstallDir('pr-kotlin-guard'); // HARNESS_X_HOME 존중
    expect(dir).toBe(join(env.home, 'plugins', 'forge', 'pr-kotlin-guard'));
    expect(s.installed).toMatchObject({ dir, trust: 'unsigned-isolated', trustLabel: '미서명·격리' });
    expect(existsSync(join(dir, '.git'))).toBe(true);
    expect(existsSync(join(dir, 'dist', 'index.js'))).toBe(true);
    expect(gitLog(dir)).toEqual(['forge: install pr-kotlin-guard (s-inst)']);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe('');

    // 다시 설치 = 새 커밋
    applyFiles(s.pluginDir, { 'src/index.ts': KOTLIN_HOOK_OK + '\n// v2\n' });
    const again = installPlugin(s.pluginDir);
    expect(gitLog(dir)).toHaveLength(2);
    expect(again.commit).not.toBe((s.installed as { commit: string }).commit);
  });

  it('다음 로더(기본 루트)가 찾아 격리 실행, GET /api/plugins에 등급 unsigned-isolated', async () => {
    env = forgeEnv();
    const spec = kotlinSpec();
    const src = join(env.dir, 'staging', spec.id);
    scaffoldFromSpec(spec, src);
    applyFiles(src, { 'src/index.ts': KOTLIN_HOOK_OK });
    expect(compilePlugin(src, { emit: true }).ok).toBe(true);
    const r = installPlugin(src, { home: env.home });
    expect(r).toMatchObject({ trust: 'unsigned-isolated', trustLabel: '미서명·격리' });

    const loader = new PluginLoader({
      hooks: new HookBus({ log: env.log }),
      log: env.log,
      roots: defaultPluginRoots({ home: env.home }),
      lockFile: join(env.home, 'plugins.lock'),
      sandbox: { trust: new TrustStore(join(env.home, 'trust.json')), workspace: env.workspace },
      lifecycleTimeoutMs: 20_000,
    });
    await loader.loadAll();
    expect(loader.rejections).toEqual([]);
    expect(loader.plugins.get(spec.id)).toMatchObject({
      origin: 'user',
      state: 'active',
      trust: 'unsigned-isolated',
      isolation: 'worker',
    });
    const server = await startApiServer({
      loader,
      log: env.log,
      port: 0,
      tokenFile: join(env.home, 'run', 'token'),
    });
    try {
      const res = (await (
        await fetch(`${server.url}/api/plugins`, { headers: { authorization: `Bearer ${server.token}` } })
      ).json()) as { plugins: { id: string; trust?: string; isolation?: string }[] };
      expect(res.plugins.find((p) => p.id === spec.id)).toMatchObject({
        trust: 'unsigned-isolated',
        isolation: 'worker',
      });
    } finally {
      await server.close();
      await loader.deactivate(spec.id, { force: true });
    }
  });
});
