import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PluginManifestSchema, type PluginManifest } from '@harness-x/protocol';

export * from './spec.js';
export * from './interview.js';
export * from './broker.js';
export * from './scaffold.js';
export * from './engine.js';
export * from './routes.js';
export * from './check.js';
export * from './sandbox.js';
export * from './install.js';
export * from './forge.js';

/** 이 플러그인 폴더 (src/와 dist/ 모두 한 단계 아래) */
export const FORGE_PLUGIN_DIR = fileURLToPath(new URL('..', import.meta.url));

/** 레지스트리용 플러그인 정보 (AgentRegistry plugins에 넣으면 /forge 에이전트가 생긴다) */
export function forgePlugin(): { manifest: PluginManifest; dir: string; state: string } {
  const manifest = PluginManifestSchema.parse(
    JSON.parse(readFileSync(new URL('../harness-plugin.json', import.meta.url), 'utf8')),
  );
  return { manifest, dir: FORGE_PLUGIN_DIR, state: 'active' };
}

/** 하네스 플러그인 진입점 */
export function activate(ctx: { log(message: string): void }): void {
  ctx.log('forge active (/forge)');
}
