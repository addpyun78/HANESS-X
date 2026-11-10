import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventLog } from '../src/event-log.js';
import { HookBus } from '../src/hooks.js';
import { PluginLoader, type PluginRoot } from '../src/loader.js';
import { tempDir } from './helpers.js';

export const HELLO_DIR = fileURLToPath(new URL('../../../examples/plugins/hello', import.meta.url));

export function makePlugin(
  root: string,
  manifest: Record<string, unknown>,
  code = 'export function activate(){}',
): string {
  const dir = join(root, String(manifest.id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'harness-plugin.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'index.js'), code);
  return dir;
}

export function engineManifest(id: string, extra: Record<string, unknown> = {}) {
  return { id, version: '1.0.0', apiVersion: 1, provides: { engine: [id] }, ...extra };
}

export function setup() {
  const t = tempDir('hx-loader-');
  const home = join(t.dir, 'home');
  const workspace = join(t.dir, 'ws');
  const userRoot = join(home, 'plugins');
  const wsRoot = join(workspace, '.harness-x', 'plugins');
  mkdirSync(userRoot, { recursive: true });
  mkdirSync(wsRoot, { recursive: true });
  const log = new EventLog({ root: join(t.dir, 'logs') });
  const hooks = new HookBus({ log });
  const lines: string[] = [];
  const roots: PluginRoot[] = [
    { dir: wsRoot, origin: 'workspace' },
    { dir: userRoot, origin: 'user' },
  ];
  const lockFile = join(home, 'plugins.lock');
  const mk = () => new PluginLoader({ hooks, log, roots, lockFile, logger: (l) => lines.push(l) });
  const copyHello = (to = wsRoot) => {
    const dest = join(to, 'hello');
    cpSync(HELLO_DIR, dest, { recursive: true });
    return dest;
  };
  return {
    ...t,
    home,
    workspace,
    userRoot,
    wsRoot,
    log,
    hooks,
    lines,
    lockFile,
    mk,
    copyHello,
    cleanup: () => {
      log.close();
      t.cleanup();
    },
  };
}
