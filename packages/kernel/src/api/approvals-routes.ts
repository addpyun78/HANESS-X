import type { FastifyInstance } from 'fastify';

/**
 * 승인 카드 API (T-027 27.3 + T-100 H.10)
 *   GET  /api/approvals?status=pending|resolved|all   쉬운 말 승인 카드 목록
 *   POST /api/approvals/:id {choice, remember}        카드 선택 (accept | redo | stop | allow-move | register | skip)
 *   POST /api/approvals/:id {decision}                판정 사다리 L5 버튼 (equivalent | move | fail, 이전 방식)
 *   POST /api/approvals/undo                          같은 세션에서 "방금 선택 취소"
 * WebSocket /ws/events로 approval_request / approval_resolved 이벤트가 함께 나간다 (이벤트 로그 경유).
 */

/** 승인 카드 버튼 (판정 사다리 L5): 동치 인정 / 이동 승인 / 실패 */
export const API_APPROVAL_DECISIONS = ['equivalent', 'move', 'fail'] as const;
export type ApiApprovalDecision = (typeof API_APPROVAL_DECISIONS)[number];

/**
 * 승인 요청 응답 처리기 (L5). 오류의 code가 APPROVAL_NOT_FOUND면 404, 그 밖의 오류는 409로 응답한다.
 */
export interface ApprovalHandler {
  resolve(approvalId: string, decision: ApiApprovalDecision, meta: { by: string }): unknown;
}

export const APPROVAL_CARD_STATUSES = ['pending', 'resolved', 'all'] as const;
export type ApprovalCardStatus = (typeof APPROVAL_CARD_STATUSES)[number];

/**
 * 쉬운 말 승인 카드 저장소 (예: approvals 플러그인 workspaceApprovals).
 * 오류 code: APPROVAL_NOT_FOUND → 404, INVALID_CHOICE → 400, 그 밖(APPROVAL_RESOLVED·NOTHING_TO_UNDO 등) → 409
 */
export interface ApprovalCardsApi {
  list(status: ApprovalCardStatus): unknown[] | Promise<unknown[]>;
  resolve(id: string, choice: string, meta: { remember: boolean; by: string }): unknown;
  undo?(): unknown;
}

export interface ApprovalRoutesOptions {
  legacy?: ApprovalHandler;
  cards?: ApprovalCardsApi;
}

function fail(reply: { code(n: number): { send(b: unknown): unknown } }, err: unknown) {
  const code = (err as { code?: unknown }).code;
  const message = err instanceof Error ? err.message : String(err);
  if (code === 'APPROVAL_NOT_FOUND') return reply.code(404).send({ error: 'not_found', message });
  if (code === 'INVALID_CHOICE') return reply.code(400).send({ error: 'invalid_choice', message });
  return reply.code(409).send({ error: 'approval_failed', ...(code ? { code } : {}), message });
}

export function registerApprovalRoutes(app: FastifyInstance, o: ApprovalRoutesOptions): void {
  app.get('/api/approvals', async (req, reply) => {
    const status = ((req.query as { status?: string }).status ?? 'pending') as ApprovalCardStatus;
    if (!(APPROVAL_CARD_STATUSES as readonly string[]).includes(status))
      return reply.code(400).send({ error: 'invalid_status', allowed: APPROVAL_CARD_STATUSES });
    return { approvals: o.cards ? await o.cards.list(status) : [] };
  });

  app.post('/api/approvals/undo', async (_req, reply) => {
    if (!o.cards?.undo) return reply.code(404).send({ error: 'not_found' });
    try {
      return { undone: await o.cards.undo() };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/approvals/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { decision?: unknown; choice?: unknown; remember?: unknown };
    // H.10 쉬운 말 카드 {choice, remember}
    if (body.choice !== undefined) {
      if (!o.cards) return reply.code(404).send({ error: 'not_found' });
      if (typeof body.choice !== 'string') return reply.code(400).send({ error: 'invalid_choice' });
      try {
        const result = await o.cards.resolve(id, body.choice, {
          remember: body.remember === true,
          by: 'api',
        });
        return { id, choice: body.choice, remember: body.remember === true, result };
      } catch (err) {
        return fail(reply, err);
      }
    }
    // 27.3 판정 사다리 L5 {decision}
    if (!o.legacy) return reply.code(404).send({ error: 'not_found' });
    const decision = body.decision;
    if (typeof decision !== 'string' || !(API_APPROVAL_DECISIONS as readonly string[]).includes(decision))
      return reply.code(400).send({ error: 'invalid_decision', allowed: API_APPROVAL_DECISIONS });
    try {
      const result = await o.legacy.resolve(id, decision as ApiApprovalDecision, { by: 'api' });
      return { id, decision, result };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
