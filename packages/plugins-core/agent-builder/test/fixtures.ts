import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventLog, HookBus, PluginLoader, type PluginRoot } from '@harness-x/kernel';

export const HELLO_DIR = fileURLToPath(new URL('../../../../examples/plugins/hello', import.meta.url));
export const DESIGN_QA_DIR = fileURLToPath(new URL('../../../../examples/agents/design-qa', import.meta.url));

/** 임시 홈·워크스페이스·플러그인 루트 */
export function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'hx-agents-'));
  const home = join(dir, 'home');
  const workspace = join(dir, 'ws');
  const pluginRoot = join(dir, 'plugins');
  mkdirSync(pluginRoot, { recursive: true });
  const log = new EventLog({ root: join(dir, 'logs') });
  const hooks = new HookBus({ log });
  const roots: PluginRoot[] = [{ dir: pluginRoot, origin: 'workspace' }];
  const loader = () => new PluginLoader({ hooks, log, roots, lockFile: join(home, 'plugins.lock') });
  return {
    dir,
    home,
    workspace,
    pluginRoot,
    loader,
    copyHello: () => cpSync(HELLO_DIR, join(pluginRoot, 'hello'), { recursive: true }),
    /** examples/agents/design-qa를 감싼 파이프라인 플러그인 */
    copyDesignQaPlugin: (id = 'design-qa') => {
      const dest = join(pluginRoot, id);
      cpSync(DESIGN_QA_DIR, dest, { recursive: true });
      writeFileSync(
        join(dest, 'harness-plugin.json'),
        JSON.stringify({
          id,
          version: '0.1.0',
          apiVersion: 1,
          displayName: 'Design QA',
          provides: { pipeline: ['design-qa'] },
        }),
      );
      writeFileSync(join(dest, 'index.js'), 'export function activate() {}\n');
      return dest;
    },
    /** <root>/<name>/agent.yaml (+ pipeline.yaml) */
    writeAgent: (root: string, name: string, agentYaml: string, pipelineYaml?: string) => {
      const d = join(root, name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'agent.yaml'), agentYaml);
      if (pipelineYaml) writeFileSync(join(d, 'pipeline.yaml'), pipelineYaml);
      return d;
    },
    cleanup: () => {
      log.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
