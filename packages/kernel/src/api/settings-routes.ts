import type { FastifyInstance } from 'fastify';
import type { CleanupResult } from '../settings/data-cleanup.js';
import { buildDiagnostics } from '../settings/diagnostics.js';
import { settingFields, settingsJsonSchema } from '../settings/json-schema.js';
import { exportSettingsYaml, importSettingsYaml } from '../settings/transfer.js';
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
 *  ── T-101 6번 설정 화면
 *  POST   /api/settings/data/cleanup   6B.11 [지금 정리하기] (보관 기간·첨부 정리)
 *  GET    /api/settings/about          6B.13 버전·운영체제
 *  POST   /api/settings/update-check   6B.13 업데이트 확인 (확인할 곳이 주입됐을 때만 네트워크)
 *  GET    /api/settings/diagnostics    6B.13 진단 파일 {file, text} — 키·첨부 내용 제외, 키 모양 글자 가림
 *  GET    /api/settings/export         6C.3 settings.yaml {file, text} — 키 제외
 *  POST   /api/settings/import         6C.3 {text} → 전부 검사 후 저장 / 400 쉬운 말 오류 목록
 */

export interface SettingsApiOptions extends Omit<SettingsStoreOptions, 'registry'> {
  /** 설정 화면에 넣을 플러그인 매니페스트들 (configSchema가 있는 것만 의미 있음) */
  plugins?: () => readonly PluginConfigSource[];
  /** 기본: 하네스 기본 레지스트리 + plugins() */
  registry?: () => SettingsRegistry;
  /** 저장 알림 (즉시 적용 연결용) */
  onChange?: (changes: SettingsChange[]) => void;
  /** 6B.11 데이터 정리 (없으면 404) */
  cleanup?: () => CleanupResult;
  /** 6B.13 정보·진단 */
  about?: {
    version: string;
    /** 최신 버전 알아보기 (없으면 "확인할 곳이 없어요") */
    checkUpdate?: () => Promise<{ latest?: string; url?: string }>;
    plugins?: () => readonly { id: string; version?: string; enabled?: boolean }[];
    engines?: () => readonly string[];
  };
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

  app.post('/api/settings/data/cleanup', async (_req, reply) => {
    if (!o.cleanup)
      return reply.code(404).send({ error: 'not_available', message: '정리 기능을 쓸 수 없어요.' });
    return { ok: true, ...o.cleanup() };
  });

  const version = o.about?.version ?? '0.0.0';
  app.get('/api/settings/about', async () => ({
    version,
    platform: process.platform,
    node: process.version,
    updateCheck: Boolean(o.about?.checkUpdate),
  }));

  app.post('/api/settings/update-check', async () => {
    if (!o.about?.checkUpdate)
      return {
        current: version,
        message: '업데이트를 확인할 곳이 아직 없어요. 지금 버전을 그대로 쓰면 돼요.',
      };
    try {
      const r = await o.about.checkUpdate();
      const newer = Boolean(r.latest && r.latest !== version);
      return {
        current: version,
        ...r,
        newer,
        message: newer ? `새 버전 ${r.latest}이 있어요.` : '지금 최신 버전이에요.',
      };
    } catch {
      return { current: version, message: '업데이트를 확인하지 못했어요. 잠시 뒤 다시 해 주세요.' };
    }
  });

  app.get('/api/settings/diagnostics', async () => ({
    file: 'harness-x-diagnostics.json',
    text: buildDiagnostics({
      version,
      store,
      ...(o.about?.plugins ? { plugins: o.about.plugins } : {}),
      ...(o.about?.engines ? { engines: o.about.engines } : {}),
    }),
  }));

  app.get('/api/settings/export', async () => ({ file: 'settings.yaml', text: exportSettingsYaml(store) }));

  app.post('/api/settings/import', async (req, reply) => {
    const b = (req.body ?? {}) as { text?: unknown };
    if (typeof b.text !== 'string')
      return reply
        .code(400)
        .send({ error: 'invalid_import', message: '가져올 파일 내용이 없어요.', issues: [] });
    const r = importSettingsYaml(store, b.text);
    if (!r.ok)
      return reply.code(400).send({
        error: 'invalid_import',
        message: '가져오지 않았어요. 아래 값을 고쳐 주세요.',
        issues: r.issues,
      });
    return { ok: true, imported: r.imported, values: store.snapshot() };
  });

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
