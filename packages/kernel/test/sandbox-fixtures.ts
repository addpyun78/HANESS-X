import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PluginLoader } from '../src/loader.js';
import { TrustStore } from '../src/sandbox/trust.js';
import { makePlugin, setup } from './plugin-fixtures.js';

/** 격리 로더 환경: 워크스페이스 + trust.json */
export function sandboxSetup() {
  const env = setup();
  const trustFile = join(env.home, 'trust.json');
  mkdirSync(env.workspace, { recursive: true });
  const mkSandboxed = (trust = new TrustStore(trustFile)) =>
    new PluginLoader({
      hooks: env.hooks,
      log: env.log,
      roots: [{ dir: env.userRoot, origin: 'user' }],
      lockFile: env.lockFile,
      logger: (l) => env.lines.push(l),
      sandbox: { trust, workspace: env.workspace },
      lifecycleTimeoutMs: 20_000,
    });
  const plugin = (id: string, code: string, extra: Record<string, unknown> = {}) =>
    makePlugin(
      env.userRoot,
      { id, version: '1.0.0', apiVersion: 1, provides: { hook: [id] }, ...extra },
      code,
    );
  return { ...env, trustFile, mkSandboxed, plugin };
}
