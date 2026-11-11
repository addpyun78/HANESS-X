import type { FastifyInstance } from 'fastify';
import { settingFields, settingsJsonSchema } from '../settings/json-schema.js';
import { withPluginSettings, type PluginConfigSource } from '../settings/plugins.js';
import { SETTING_GROUPS, SettingValueError, type SettingsRegistry } from '../settings/registry.js';
import {
  SettingsStore,
  type ResetTarget,
  type SaveScope,
  type SettingsChange,
  type SettingsStoreOptions,
} from '../settings/store.js';

/**
 * T-101 0-1 설정 화면 API (startApiServer의 `settings` 옵션으로 켠다)
 *  GET    /api/settings?project=<id>   그룹 + 키 목록(JSON Schema·메타) + 현재 값(전체/프로젝트/실제)
 *  GET    /api/settings/schema         settings.json 전체 JSON Schema
 *  PUT    /api/settings                {key, value, scope?, project?} → 검사 후 저장(즉시 적용) / 400 쉬운 말 오류
 *  POST   /api/settings/reset          {key | group | all, scope?, project?} → 기본값으로
 *  PUT    /api/settings/secret         {key, value} → 키체인, 응답은 가린 값만
 *  DELETE /api/settings/secret?key=
 */

export interface SettingsApiOptions extends Omit<SettingsStoreOptions, 'registry'> {
  /** 설정 화면에 넣을 플러그인 매니페스트들 (configSchema가 있는 것만 의미 있음) */
  plugins?: () => readonly PluginConfigSource[];
  /** 기본: 하네스 기본 레지스트리 + plugins() */
  registry?: () => SettingsRegistry;
  /** 저장 알림 (즉시 적용 연결용) */
  onChange?: (changes: SettingsChange[]) => void;
}

export function createSettingsStore(o: SettingsApiOptions = {}): SettingsStore {
  const registry = o.registry ?? (() => withPluginSettings(o.plugins?.() ?? []));
  const store = new SettingsStore({ ...o, registry });
  if (o.onChange) store.subscribe(o.onChange);
  return store;
}

const scopeOf = (v: unknown): SaveScope | undefined =>
  v === 'project' ? 'project' : v === 'global' ? 'global' : undefined;

export type SettingsRoutesOptions = SettingsApiOptions & { store?: SettingsStore };

export function registerSettingsRoutes(app: FastifyInstance, o: SettingsRoutesOptions) {
  const store = o.store ?? createSettingsStore(o);

  const fail = (reply: { code(n: number): { send(b: unknown): unknown } }, err: unknown) => {
    if (err instanceof SettingValueError)
      return reply.code(400).send({ error: 'invalid_value', key: err.key, message: err.message });
    throw err;
  };

  app.get('/api/settings', async (req) => {
    const { project } = (req.query ?? {}) as { project?: string };
    const reg = store.registry;
    return {
      groups: SETTING_GROUPS,
      fields: settingFields(reg),
      values: store.snapshot(project || undefined),
      projectSettings: Boolean(o.project),
    };
  });

  app.get('/api/settings/schema', async () => settingsJsonSchema(store.registry));

  app.put('/api/settings', async (req, reply) => {
    const b = (req.body ?? {}) as { key?: unknown; value?: unknown; scope?: unknown; project?: unknown };
    if (typeof b.key !== 'string')
      return reply.code(400).send({ error: 'bad_key', message: '설정 이름이 없어요.' });
    try {
      const scope = scopeOf(b.scope);
      return store.set(b.key, b.value, {
        ...(scope ? { scope } : {}),
        ...(typeof b.project === 'string' && b.project ? { projectId: b.project } : {}),
      });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/settings/reset', async (req, reply) => {
    const b = (req.body ?? {}) as {
      key?: unknown;
      group?: unknown;
      all?: unknown;
      scope?: unknown;
      project?: unknown;
    };
    const target: ResetTarget | undefined =
      typeof b.key === 'string'
        ? { key: b.key }
        : typeof b.group === 'string'
          ? { group: b.group }
          : b.all === true
            ? { all: true }
            : undefined;
    if (!target) return reply.code(400).send({ error: 'bad_target', message: '되돌릴 대상을 골라 주세요.' });
    const projectId = typeof b.project === 'string' && b.project ? b.project : undefined;
    try {
      const scope = scopeOf(b.scope);
      const reset = store.reset(target, { ...(scope ? { scope } : {}), ...(projectId ? { projectId } : {}) });
      return { ok: true, reset, values: store.snapshot(projectId) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put('/api/settings/secret', async (req, reply) => {
    const b = (req.body ?? {}) as { key?: unknown; value?: unknown };
    if (typeof b.key !== 'string' || typeof b.value !== 'string')
      return reply.code(400).send({ error: 'invalid_value', message: '키를 넣어 주세요.' });
    try {
      return { ok: true, key: b.key, ...store.setSecret(b.key, b.value) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/settings/secret', async (req, reply) => {
    const { key } = (req.query ?? {}) as { key?: string };
    if (!key) return reply.code(400).send({ error: 'bad_key', message: '설정 이름이 없어요.' });
    try {
      return { ok: true, key, deleted: store.deleteSecret(key), masked: null };
    } catch (err) {
      return fail(reply, err);
    }
  });

  return store;
}
