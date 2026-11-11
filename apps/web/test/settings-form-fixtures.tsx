import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// 커널 설정 모듈을 직접 불러온다 (서버 없이 실제 검사·저장 규칙으로 화면을 시험)
import { settingFields } from '../../../packages/kernel/src/settings/json-schema.js';
import {
  withPluginSettings,
  type PluginConfigSource,
} from '../../../packages/kernel/src/settings/plugins.js';
import {
  SETTING_GROUPS,
  SettingValueError,
  settingsRegistry,
  type SettingsRegistry,
} from '../../../packages/kernel/src/settings/registry.js';
import { SettingsStore, type ProjectSettingsIO } from '../../../packages/kernel/src/settings/store.js';
import type { SettingsApi } from '../src/settings/form/api.js';
import type { SettingField, SettingsResponse } from '../src/settings/form/types.js';

/** T-101 0-1 설정 폼 테스트 공용: 커널 SettingsStore를 그대로 쓰는 가짜 /api/settings */
export interface MemorySettings {
  api: SettingsApi & { calls: unknown[][] };
  store: SettingsStore;
  secrets: Map<string, string>;
  dispose(): void;
}

const apiError = (e: unknown) => {
  if (e instanceof SettingValueError)
    return Object.assign(new Error('400'), {
      status: 400,
      body: { error: 'invalid_value', key: e.key, message: e.message },
    });
  return e;
};

export function memorySettings(
  opts: { registry?: SettingsRegistry; plugins?: PluginConfigSource[]; project?: ProjectSettingsIO } = {},
): MemorySettings {
  const dir = mkdtempSync(join(tmpdir(), 'hx-web-settings-'));
  const registry = opts.registry ?? withPluginSettings(opts.plugins ?? [], settingsRegistry);
  const secrets = new Map<string, string>();
  const store = new SettingsStore({
    file: join(dir, 'settings.json'),
    registry,
    secrets: {
      get: (a) => secrets.get(a) ?? null,
      set: (a, v) => void secrets.set(a, v),
      delete: (a) => secrets.delete(a),
    },
    ...(opts.project ? { project: opts.project } : {}),
  });
  const calls: unknown[][] = [];
  const wrap = async <T,>(fn: () => T): Promise<T> => {
    try {
      return fn();
    } catch (e) {
      throw apiError(e);
    }
  };
  const api: SettingsApi & { calls: unknown[][] } = {
    calls,
    load: async (project) => ({
      groups: SETTING_GROUPS.map((g) => ({ ...g })),
      fields: settingFields(registry) as SettingField[],
      values: store.snapshot(project),
      projectSettings: Boolean(opts.project),
    }),
    save: (key, value, scope, project) => {
      calls.push(['save', key, value, scope ?? 'global']);
      return wrap(() =>
        store.set(key, value, { ...(scope ? { scope } : {}), ...(project ? { projectId: project } : {}) }),
      );
    },
    reset: (target, scope, project) => {
      calls.push(['reset', target, scope ?? 'global']);
      return wrap(() => ({
        ok: true as const,
        reset: store.reset(target, {
          ...(scope ? { scope } : {}),
          ...(project ? { projectId: project } : {}),
        }),
        values: store.snapshot(project),
      }));
    },
    saveSecret: (key, value) => {
      calls.push(['saveSecret', key, value.length]);
      return wrap(() => store.setSecret(key, value));
    },
    deleteSecret: (key) => {
      calls.push(['deleteSecret', key]);
      return wrap(() => store.deleteSecret(key));
    },
  };
  return { api, store, secrets, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 레지스트리 응답 (값은 기본값) */
export function registryResponse(registry: SettingsRegistry = settingsRegistry): SettingsResponse {
  const m = memorySettings({ registry });
  const fields = settingFields(registry) as SettingField[];
  const values = m.store.snapshot();
  m.dispose();
  return { groups: SETTING_GROUPS.map((g) => ({ ...g })), fields, values };
}

/** 위젯 시험용 field 하나 */
export function field(
  over: Partial<SettingField> & Pick<SettingField, 'key' | 'widget' | 'schema'>,
): SettingField {
  return {
    path: over.key.split('.'),
    group: 'general',
    title: '시험 항목',
    description: '시험에 쓰는 항목이에요.',
    advanced: false,
    restartRequired: false,
    scope: 'global',
    storage: 'settings',
    default: over.schema.default ?? null,
    ...over,
  };
}

/** 메모리 브라우저 저장소 */
export function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}
