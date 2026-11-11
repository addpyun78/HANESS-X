import type { FastifyInstance } from 'fastify';
import { MainAiSchema, type MainAi, type ModelsResponse } from '@harness-x/protocol';
import { defaultMainAiFile, readMainAi, writeMainAi, type SessionAiOverrides } from '../main-ai.js';
import type { ModelCatalog } from '../models.js';

/**
 * T-101 5B.4 / 5C 모델·메인 AI API
 *  GET  /api/models            모델 목록 (캐시 즉시, 재스캔 뒤 갱신) — ModelsResponse
 *  GET  /api/main-ai           { main: MainAi | null }
 *  PUT  /api/main-ai           { engine, model? } → settings.json main.*
 *  PUT  /api/sessions/:id/ai   { engine, model? } → 그 세션만, 다음 턴부터 (기록 남김)
 */

export interface ModelRoutesOptions {
  catalog: Pick<ModelCatalog, 'get' | 'peek'>;
  /** 기본 ~/.harness-x/settings.json */
  settingsFile?: string;
  sessions?: Pick<SessionAiOverrides, 'set'>;
  /** 캐시가 있을 때 새 목록을 기다리는 최대 시간 (기본 300ms, 넘으면 캐시로 답하고 뒤에서 마저 만든다) */
  freshWaitMs?: number;
}

const ENGINE_RE = /^[a-z0-9]+([-.:][a-z0-9]+)*$/;

function parseChoice(body: unknown): MainAi | undefined {
  const r = MainAiSchema.safeParse(body);
  return r.success && ENGINE_RE.test(r.data.engine) ? r.data : undefined;
}

export function registerModelRoutes(app: FastifyInstance, o: ModelRoutesOptions): void {
  const file = o.settingsFile ?? defaultMainAiFile();

  app.get('/api/models', async (): Promise<ModelsResponse> => {
    const fresh = o.catalog.get();
    const cached = o.catalog.peek();
    if (!cached) return fresh;
    fresh.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<ModelsResponse>((r) => {
      timer = setTimeout(() => r(cached), o.freshWaitMs ?? 300);
    });
    return Promise.race([fresh.catch(() => cached), late]).finally(() => clearTimeout(timer));
  });

  app.get('/api/main-ai', async () => ({ main: readMainAi(file) ?? null }));

  app.put('/api/main-ai', async (req, reply) => {
    const choice = parseChoice(req.body);
    if (!choice) return reply.code(400).send({ error: 'bad_main_ai' });
    return { ok: true, main: writeMainAi(choice, file) };
  });

  app.put('/api/sessions/:id/ai', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!o.sessions) return reply.code(503).send({ error: 'sessions_off' });
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) return reply.code(400).send({ error: 'bad_session_id' });
    const choice = parseChoice(req.body);
    if (!choice) return reply.code(400).send({ error: 'bad_ai' });
    return { ok: true, record: o.sessions.set(id, choice) };
  });
}
