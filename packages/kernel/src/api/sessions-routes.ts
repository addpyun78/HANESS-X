import type { FastifyInstance, FastifyReply } from 'fastify';
import { DispatchError, type Dispatcher, type DispatchModifiers } from '../dispatch.js';
import { registerStopRoutes } from './stop-routes.js';
import { createDraftFromRequest, sendProjectError } from '../projects/routes.js';
import type { SessionRegistry } from '../projects/session-registry.js';
import { isRunMode } from '@harness-x/protocol';

/**
 * 48.1 / 실행 디스패치 API
 * - POST /api/sessions {agent, prompt, modifiers?} → 201 세션 (session_created 이벤트). 수식어는 prompt 안(@엔진 #strict !plan !auto)
 *   또는 modifiers 객체 {engine?, strict?, planOnly?}로 준다.
 * - GET  /api/sessions            → {sessions: [...]} (현재 노드·진행률)
 * - GET  /api/sessions/:id        → 세션
 * - POST /api/sessions/:id/subagents {agent} → 48.4 실행 중 세션에 서브에이전트 추가
 * - T-101 0B.11 POST /api/sessions {projectId?} (agent 없음) → 초안 세션 (registry가 있을 때)
 */

const STATUS: Record<DispatchError['code'], number> = {
  invalid_request: 400,
  unknown_engine: 400,
  unknown_agent: 404,
  not_found: 404,
  not_running: 409,
  incomplete_agent: 409,
};

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof DispatchError)
    return reply.code(STATUS[err.code]).send({ error: err.code, message: err.message });
  throw err;
}

export function registerSessionRoutes(
  app: FastifyInstance,
  dispatcher: Dispatcher,
  registry?: SessionRegistry,
): void {
  // T-101 2A.2 정지 3종 (일시정지 / 지금 멈추기 / 전체 정지)
  registerStopRoutes(app, dispatcher);
  app.post('/api/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as {
      agent?: unknown;
      prompt?: unknown;
      modifiers?: unknown;
      projectId?: unknown;
      origin?: unknown;
      mode?: unknown;
    };
    if (registry && body.agent === undefined) {
      try {
        return reply.code(201).send(createDraftFromRequest(registry, body));
      } catch (err) {
        return sendProjectError(reply, err);
      }
    }
    try {
      const session = dispatcher.dispatch({
        agent: typeof body.agent === 'string' ? body.agent : '',
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        ...(typeof body.projectId === 'string' && body.projectId ? { projectId: body.projectId } : {}),
        ...(isRunMode(body.mode) ? { mode: body.mode } : {}),
        ...(body.origin === 'cli' || body.origin === 'api' || body.origin === 'resume'
          ? { origin: body.origin }
          : {}),
        ...(body.modifiers && typeof body.modifiers === 'object'
          ? { modifiers: body.modifiers as Partial<DispatchModifiers> }
          : {}),
      });
      return reply.code(201).send(session);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/sessions', async () => ({ sessions: dispatcher.sessions() }));

  app.get('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = dispatcher.get(id);
    return s ?? reply.code(404).send({ error: 'not_found' });
  });

  app.post('/api/sessions/:id/subagents', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { agent } = (req.body ?? {}) as { agent?: unknown };
    try {
      return dispatcher.addSubagent(id, typeof agent === 'string' ? agent : '');
    } catch (err) {
      return fail(reply, err);
    }
  });
}
