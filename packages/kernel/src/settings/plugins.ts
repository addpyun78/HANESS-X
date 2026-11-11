import { z } from 'zod';
import {
  defineSetting,
  getPath,
  settingsRegistry,
  type SettingDef,
  type SettingsRegistry,
  type SettingWidget,
} from './registry.js';

/**
 * T-101 0A.9 플러그인 `configSchema`(매니페스트의 JSON Schema) 자동 포함.
 * 속성 하나 = 설정 키 `plugins.<플러그인 id>.<속성>` (settings.json 경로 ['plugins', id, 속성]),
 * 그룹 "플러그인", 화면에서는 플러그인별 소제목 아래에 보인다.
 */

export interface PluginConfigSource {
  id: string;
  displayName?: string;
  configSchema?: Record<string, unknown>;
}

const WIDGETS: readonly SettingWidget[] = [
  'boolean',
  'enum',
  'number',
  'string',
  'array',
  'engine',
  'model',
  'folder',
];

function propSchema(js: Record<string, unknown>): z.ZodType {
  let s: z.ZodType;
  try {
    s = z.fromJSONSchema(js as never);
  } catch {
    s = z.unknown();
  }
  if ('default' in js) s = (s as z.ZodType<unknown>).default(js.default as never);
  else s = s.optional();
  return s;
}

/** 플러그인 하나의 설정 키들 */
export function pluginSettingDefs(p: PluginConfigSource): SettingDef[] {
  const props = (p.configSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const title = p.displayName ?? p.id;
  return Object.entries(props).map(([name, js]) => {
    const t = typeof js.title === 'string' && js.title ? js.title : name;
    const w = js['x-widget'];
    return defineSetting(`plugins.${p.id}.${name}`, propSchema(js), {
      path: ['plugins', p.id, name],
      group: 'plugins',
      title: t,
      description:
        typeof js.description === 'string' && js.description
          ? js.description
          : `${title} 플러그인의 "${t}" 설정이에요.`,
      advanced: js['x-advanced'] === true,
      // 플러그인은 켜질 때 설정을 받는다
      restartRequired: true,
      scope: 'global',
      plugin: { id: p.id, title },
      ...(typeof w === 'string' && (WIDGETS as readonly string[]).includes(w)
        ? { widget: w as SettingWidget }
        : {}),
    });
  });
}

/** 기본 레지스트리 + 플러그인 설정 (새 레지스트리) */
export function withPluginSettings(
  plugins: readonly PluginConfigSource[],
  base: SettingsRegistry = settingsRegistry,
): SettingsRegistry {
  const r = base.clone();
  for (const p of plugins) for (const d of pluginSettingDefs(p)) if (!r.has(d.key)) r.register(d);
  return r;
}

/** settings.json → 플러그인 로더 `config` (플러그인 id → 설정 객체) */
export function pluginConfigsFrom(values: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const p = getPath(values, ['plugins']);
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  return Object.fromEntries(
    Object.entries(p as Record<string, unknown>).filter(
      (e): e is [string, Record<string, unknown>] =>
        !!e[1] && typeof e[1] === 'object' && !Array.isArray(e[1]),
    ),
  );
}
