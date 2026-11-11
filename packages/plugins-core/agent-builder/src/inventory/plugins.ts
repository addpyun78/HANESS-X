import { providedSlots, type PluginManifest } from '@harness-x/protocol';
import { pluginHealth } from './health.js';
import type { PluginAsset } from './schema.js';

/**
 * P4-A.2 플러그인 수집: id·버전·슬롯·제공 명령·권한·활성 여부.
 * 매니페스트(harness-plugin.json)에서 읽은 값만 쓴다 — 플러그인 코드·모듈은 보지 않는다.
 */

/** kernel LoadedPlugin과 호환되는 최소 모양 (module 필드는 읽지 않는다) */
export interface InventoryPluginSource {
  manifest: PluginManifest;
  dir: string;
  state?: string;
  origin?: string;
}

export function collectPlugins(plugins: Iterable<InventoryPluginSource>): PluginAsset[] {
  const out: PluginAsset[] = [];
  for (const p of plugins) {
    const m = p.manifest;
    out.push({
      id: m.id,
      version: m.version,
      ...(m.displayName ? { displayName: m.displayName } : {}),
      ...(m.description ? { description: m.description } : {}),
      slots: providedSlots(m),
      commands: [...(m.provides.command ?? [])],
      permissions: {
        fs: [...(m.permissions?.fs ?? [])],
        net: [...(m.permissions?.net ?? [])],
        shell: m.permissions?.shell ?? false,
      },
      enabled: !p.state || p.state === 'active',
      ...(p.origin ? { origin: p.origin } : {}),
      health: pluginHealth(p),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
