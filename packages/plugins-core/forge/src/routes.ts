import { ForgeAnswerError, type ForgeBroker } from './broker.js';

/**
 * Forge 카드 응답 API (startApiServer({ routes }) 로 붙인다 — 토큰 검사 적용)
 * - GET  /api/forge/pending[?sessionId=]   → { cards: ForgeCard[] }
 * - POST /api/forge/answers/:id {value, text?} → { approvalId, answer }  (forge_answer 이벤트 기록)
 *   404 not_found(대기 중인 카드 없음) / 400 invalid_answer(선택지 밖 값)
 */

interface Reply {
  code(n: number): { send(body: unknown): unknown };
}
interface Req {
  params: unknown;
  query: unknown;
  body: unknown;
}
type Handler = (req: Req, reply: Reply) => Promise<unknown>;
/** fastify 인스턴스의 필요한 부분만 */
export interface RouteHost {
  get(path: string, handler: Handler): unknown;
  post(path: string, handler: Handler): unknown;
}

export function registerForgeRoutes(app: RouteHost, broker: ForgeBroker): void {
  app.get('/api/forge/pending', async (req) => {
    const q = (req.query ?? {}) as { sessionId?: unknown };
    return { cards: broker.pending(typeof q.sessionId === 'string' ? q.sessionId : undefined) };
  });
  app.post('/api/forge/answers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { value?: unknown; text?: unknown };
    try {
      return { approvalId: id, answer: broker.answer(id, body) };
    } catch (err) {
      if (err instanceof ForgeAnswerError)
        return reply
          .code(err.code === 'not_found' ? 404 : 400)
          .send({ error: err.code, message: err.message });
      throw err;
    }
  });
}
