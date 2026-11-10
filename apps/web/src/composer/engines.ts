import type { PluginsResponse } from '../api/client.js';
import type { EngineOption } from './types.js';

/** GET /api/plugins 응답에서 엔진 슬롯을 제공하는 플러그인 → 감지된 엔진 목록 */
export function enginesFromPlugins(res: PluginsResponse): EngineOption[] {
  const out: EngineOption[] = [];
  for (const p of res.plugins) {
    if (!p.slots.includes('engine')) continue;
    const ids = Array.isArray(p.provides?.engine) ? (p.provides.engine as unknown[]).map(String) : [p.id];
    for (const id of ids)
      out.push({ id, label: ids.length > 1 ? id : p.displayName || id, available: p.state === 'active' });
  }
  return out;
}
