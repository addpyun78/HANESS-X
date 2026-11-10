import type { FastifyInstance } from 'fastify';
import type { EngineAdapter, HarnessEvent } from '@harness-x/protocol';
import type { LoginStatus } from '../auth-status.js';
import {
  AuthModeSchema,
  defaultEnginesSettingsFile,
  loadEnginesSettings,
  writeEnginesSettings,
  type EnginesSettings,
} from '../engines-settings.js';
import { buildEngineEnv, ENGINE_API_KEY_ENV, type SecretStore } from '../secrets.js';

/**
 * T-038 설정 > 엔진 화면용 API (startApiServer의 `engines` 옵션으로 켠다)
 *  GET    /api/engines                 스캔 결과 + 설정 + 키 마스킹 상태 (키 원문은 절대 반환하지 않음)
 *  POST   /api/engines/rescan          다시 스캔 (rescan 제공 시)
 *  GET    /api/engines/:id/login       공식 CLI 상태 명령으로 로그인 상태
 *  PUT    /api/engines/:id/settings    {mode?, model?, fallback?} → engines-settings.yaml
 *  PUT    /api/engines/:id/key         {key} → OS 키체인, 응답은 마스킹 값만
 *  DELETE /api/engines/:id/key
 *  POST   /api/engines/:id/ping        1턴 핑 → {ok, text, latencyMs}
 */

/** 스캐너 캐시(engines.json) 모양 — 커널은 스캐너 패키지에 의존하지 않으므로 구조적으로만 본다 */
export interface EngineScanSnapshot {
  scannedAt?: string;
  platform?: string;
  engines: {
    name: string;
    location: string;
    path: string;
    version: string | null;
    status: string;
    minVersion?: string;
    error?: string;
  }[];
  localLlms?: unknown[];
}

export interface EnginesApiOptions {
  secrets: SecretStore;
  /** 기본 ~/.harness-x/engines-settings.yaml */
  settingsFile?: string;
  /** 마지막 스캔 결과 (없으면 null) */
  scan: () => EngineScanSnapshot | null | Promise<EngineScanSnapshot | null>;
  /** 다시 스캔 */
  rescan?: () => Promise<EngineScanSnapshot>;
  loginStatus?: (engineId: string) => Promise<LoginStatus>;
  /** 핑에 쓸 엔진 어댑터들 */
  adapters?: () => readonly EngineAdapter[];
  /** 핑 실행 폴더 (기본 process.cwd()) */
  pingCwd?: string | (() => string);
  pingTimeoutMs?: number;
}

export interface MaskedKey {
  masked: string;
}

/** 키 표시용 마스킹: 끝 4자만 (12자 미만이면 전부 가림) */
export function maskApiKey(key: string): string {
  return key.length >= 12 ? `••••${key.slice(-4)}` : '••••';
}

const ENGINE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const PING_PROMPT = 'ping — 다른 말 없이 pong 한 단어로만 답하세요.';

export interface PingResult {
  ok: boolean;
  engineId: string;
  text: string;
  latencyMs: number;
  error?: string;
}

/** 38.4 1턴 핑: 어댑터 run → assistant_text 모으기 → turn_end까지 걸린 시간 */
export async function pingEngine(
  adapter: EngineAdapter,
  opts: {
    cwd: string;
    mode: 'subscription' | 'apiKey';
    model?: string;
    secrets: SecretStore;
    timeoutMs?: number;
  },
): Promise<PingResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let text = '';
  let partial = '';
  let error: string | undefined;
  let env: Record<string, string | undefined>;
  try {
    env = buildEngineEnv({ engineId: adapter.id, mode: opts.mode, store: opts.secrets });
  } catch (err) {
    return { ok: false, engineId: adapter.id, text: '', latencyMs: 0, error: (err as Error).message };
  }
  const ac = new AbortController();
  const run = adapter.run({
    sessionId: `ping-${Date.now()}`,
    prompt: PING_PROMPT,
    cwd: opts.cwd,
    permission: 'read-only',
    auth: opts.mode,
    env,
    signal: ac.signal,
    ...(opts.model ? { model: opts.model } : {}),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((res) => {
    timer = setTimeout(() => res('timeout'), opts.timeoutMs ?? 60_000);
  });
  const consume = (async () => {
    for await (const e of run.events as AsyncIterable<HarnessEvent>) {
      if (e.type === 'assistant_text') {
        if (e.partial) partial += e.text;
        else text += e.text;
      } else if (e.type === 'error') error = `${e.code}: ${e.message}`;
      else if (e.type === 'turn_end') {
        if (e.reason !== 'completed' && !error) error = `turn_end: ${e.reason}`;
        break;
      }
    }
    return 'done' as const;
  })();
  const r = await Promise.race([consume, timeout]).finally(() => clearTimeout(timer));
  const latencyMs = elapsed();
  if (r === 'timeout') {
    ac.abort();
    await run.interrupt().catch(() => {});
    return { ok: false, engineId: adapter.id, text: text || partial, latencyMs, error: 'timeout' };
  }
  const out = (text || partial).trim();
  return {
    ok: !error,
    engineId: adapter.id,
    text: out,
    latencyMs,
    ...(error ? { error } : {}),
  };
}

export function registerEngineRoutes(app: FastifyInstance, o: EnginesApiOptions): void {
  const file = o.settingsFile ?? defaultEnginesSettingsFile();
  const load = (): EnginesSettings => loadEnginesSettings(file);
  const keyState = (id: string): MaskedKey | null => {
    try {
      const k = o.secrets.getApiKey(id);
      return k ? { masked: maskApiKey(k) } : null;
    } catch {
      return null;
    }
  };
  const badId = (id: string) => !ENGINE_ID_RE.test(id);

  app.get('/api/engines', async (_req, reply) => {
    let settings: EnginesSettings;
    try {
      settings = load();
    } catch (err) {
      return reply.code(500).send({ error: 'settings_invalid', message: (err as Error).message });
    }
    const ids = new Set([...Object.keys(ENGINE_API_KEY_ENV), ...Object.keys(settings.engines)]);
    const keys: Record<string, MaskedKey | null> = {};
    for (const id of ids) keys[id] = keyState(id);
    return {
      scan: (await o.scan()) ?? null,
      settings,
      keys,
      adapters: (o.adapters?.() ?? []).map((a) => ({ id: a.id, displayName: a.displayName })),
    };
  });

  if (o.rescan) {
    const rescan = o.rescan;
    app.post('/api/engines/rescan', async () => ({ ok: true, cache: await rescan() }));
  }

  app.get('/api/engines/:id/login', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (badId(id)) return reply.code(400).send({ error: 'bad_engine_id' });
    if (!o.loginStatus) return { engine: id, state: 'unknown', source: 'none' };
    return o.loginStatus(id);
  });

  app.put('/api/engines/:id/settings', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (badId(id)) return reply.code(400).send({ error: 'bad_engine_id' });
    const body = (req.body ?? {}) as { mode?: unknown; model?: unknown; fallback?: unknown };
    let cur: EnginesSettings;
    try {
      cur = load();
    } catch {
      cur = { engines: {} };
    }
    const prev = cur.engines[id] ?? { mode: 'subscription' as const, fallback: [] };
    const next = { ...prev };
    if (body.mode !== undefined) {
      const m = AuthModeSchema.safeParse(body.mode);
      if (!m.success) return reply.code(400).send({ error: 'bad_mode' });
      next.mode = m.data;
    }
    if (body.model !== undefined) {
      if (body.model === null || body.model === '') delete next.model;
      else if (typeof body.model === 'string') next.model = body.model;
      else return reply.code(400).send({ error: 'bad_model' });
    }
    if (body.fallback !== undefined) {
      const fb = body.fallback === null ? [] : Array.isArray(body.fallback) ? body.fallback : [body.fallback];
      if (!fb.every((f): f is string => typeof f === 'string' && ENGINE_ID_RE.test(f) && f !== id))
        return reply.code(400).send({ error: 'bad_fallback' });
      next.fallback = fb;
    }
    const engines = { ...cur.engines, [id]: next };
    // 폴백 대상이 아직 설정에 없으면 구독 모드 기본값으로 추가 (스키마: 대상이 engines에 있어야 함)
    for (const f of next.fallback) engines[f] ??= { mode: 'subscription', fallback: [] };
    try {
      const saved = writeEnginesSettings({ engines }, file);
      return { ok: true, settings: saved };
    } catch (err) {
      return reply.code(400).send({ error: 'settings_invalid', message: (err as Error).message });
    }
  });

  app.put('/api/engines/:id/key', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (badId(id)) return reply.code(400).send({ error: 'bad_engine_id' });
    const key = (req.body as { key?: unknown } | undefined)?.key;
    if (typeof key !== 'string' || !key.trim()) return reply.code(400).send({ error: 'empty_key' });
    o.secrets.setApiKey(id, key.trim());
    return { ok: true, engine: id, key: { masked: maskApiKey(key.trim()) } };
  });

  app.delete('/api/engines/:id/key', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (badId(id)) return reply.code(400).send({ error: 'bad_engine_id' });
    return { ok: true, engine: id, deleted: o.secrets.deleteApiKey(id), key: null };
  });

  app.post('/api/engines/:id/ping', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (badId(id)) return reply.code(400).send({ error: 'bad_engine_id' });
    const adapter = o.adapters?.().find((a) => a.id === id);
    if (!adapter) return reply.code(404).send({ error: 'engine_not_loaded', engine: id });
    let setting: EnginesSettings['engines'][string] | undefined;
    try {
      setting = load().engines[id];
    } catch {
      setting = undefined;
    }
    const cwd = typeof o.pingCwd === 'function' ? o.pingCwd() : (o.pingCwd ?? process.cwd());
    return pingEngine(adapter, {
      cwd,
      mode: setting?.mode ?? 'subscription',
      secrets: o.secrets,
      ...(setting?.model ? { model: setting.model } : {}),
      ...(o.pingTimeoutMs ? { timeoutMs: o.pingTimeoutMs } : {}),
    });
  });
}
