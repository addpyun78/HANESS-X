import type { FastifyInstance, FastifyReply } from 'fastify';
import { DispatchError, type Dispatcher } from '../dispatch.js';

/**
 * T-101 2A.2 정지 API
 * - POST /api/sessions/:id/pause  → 202 {state:'pausing'} (안전한 지점에서 멈춤)
 * - POST /api/sessions/:id/stop   → 200 {state:'paused'} (지금 멈추기)
 * - POST /api/sessions/stop-all   → 200 {results:[…]} (실행 중 세션 전부)
 * 실행 중이 아니면 409 not_running, 없는 세션은 404.
 */
export function registerStopRoutes(app: FastifyInstance, dispatcher: Dispatcher): void {
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof DispatchError && err.code === 'not_found')
      return reply.code(404).send({ error: err.code });
    throw err;
  };
  app.post('/api/sessions/stop-all', async () => ({ results: await dispatcher.stopAll('user') }));
  app.post('/api/sessions/:id/pause', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const r = dispatcher.pause(id, 'user');
      return reply.code(r.state === 'not_running' ? 409 : 202).send(r);
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/sessions/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const r = await dispatcher.stopNow(id, 'user');
      return reply.code(r.state === 'not_running' ? 409 : 200).send(r);
    } catch (err) {
      return fail(reply, err);
    }
  });
}
