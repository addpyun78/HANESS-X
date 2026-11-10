import type { FastifyInstance, FastifyReply } from 'fastify';
import { DispatchError, type Dispatcher, type DispatchModifiers } from '../dispatch.js';

/**
 * 48.1 / 실행 디스패치 API
 * - POST /api/sessions {agent, prompt, modifiers?} → 201 세션 (session_created 이벤트). 수식어는 prompt 안(@엔진 #strict !plan)
 *   또는 modifiers 객체 {engine?, strict?, planOnly?}로 준다.
 * - GET  /api/sessions            → {sessions: [...]} (현재 노드·진행률)
 * - GET  /api/sessions/:id        → 세션
 * - POST /api/sessions/:id/subagents {agent} → 48.4 실행 중 세션에 서브에이전트 추가
 */

const STATUS: Record<DispatchError['code'], number> = {
  invalid_request: 400,
  unknown_engine: 400,
  unknown_agent: 404,
  not_found: 404,
  not_running: 409,
};

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof DispatchError)
    return reply.code(STATUS[err.code]).send({ error: err.code, message: err.message });
  throw err;
}

export function registerSessionRoutes(app: FastifyInstance, dispatcher: Dispatcher): void {
  app.post('/api/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as { agent?: unknown; prompt?: unknown; modifiers?: unknown };
    try {
      const session = dispatcher.dispatch({
        agent: typeof body.agent === 'string' ? body.agent : '',
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
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
