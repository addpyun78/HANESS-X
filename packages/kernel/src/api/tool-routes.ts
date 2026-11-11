import type { FastifyInstance } from 'fastify';

/**
 * T-100 Part 3 도구 찾기 API (구현은 @harness-x/tool-finder의 createToolFinderApi).
 *  POST /api/tools/find {capability, why?, itemId?, nodeId?}       — 도구 목록 먼저 → 후보 2~5개 (설치 없음)
 *  POST /api/tools/plan-selected {need, candidates[]}              — 고른 후보마다 Part 2 설치 계획 (실행 없음)
 *  POST /api/tools/continue {need, itemId, possible, ...}          — [설치 없이 계속]
 * 설치 실행은 기존 /api/install/execute + 클릭 토큰으로만.
 */
export interface ToolFinderApi {
  find(req: Record<string, unknown>): Promise<unknown>;
  planSelected(req: Record<string, unknown>): Promise<unknown>;
  continueWithout(req: Record<string, unknown>): Promise<unknown>;
}

export function registerToolRoutes(app: FastifyInstance, api: ToolFinderApi): void {
  const run = async (
    fn: () => Promise<unknown>,
    reply: { code(n: number): { send(b: unknown): unknown } },
  ) => {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: unknown };
      return reply.code(400).send({
        error: typeof e.code === 'string' ? e.code : 'tools_failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
  app.post('/api/tools/find', async (req, reply) =>
    run(() => api.find((req.body ?? {}) as Record<string, unknown>), reply),
  );
  app.post('/api/tools/plan-selected', async (req, reply) =>
    run(() => api.planSelected((req.body ?? {}) as Record<string, unknown>), reply),
  );
  app.post('/api/tools/continue', async (req, reply) =>
    run(() => api.continueWithout((req.body ?? {}) as Record<string, unknown>), reply),
  );
}
