import type { HarnessApiClient } from '../../api/client.js';
import type { ApprovalCardData, ChoiceId } from './model.js';

/** 커널 승인 카드 라우트 (kernel api/approvals-routes.ts) */
export interface ApprovalsApi {
  /** GET /api/approvals?status=pending */
  pending(): Promise<ApprovalCardData[]>;
  /** POST /api/approvals/:id {choice, remember} */
  choose(
    id: string,
    choice: ChoiceId,
    remember: boolean,
  ): Promise<{ result?: { outcome?: { message?: string } } }>;
  /** POST /api/approvals/undo */
  undo(): Promise<unknown>;
}

const enc = encodeURIComponent;

export function approvalsApi(c: Pick<HarnessApiClient, 'request'>): ApprovalsApi {
  return {
    pending: async () =>
      (
        await c.request<{ approvals: { card: ApprovalCardData }[] }>('/api/approvals?status=pending')
      ).approvals.map((a) => a.card),
    choose: (id, choice, remember) =>
      c.request(`/api/approvals/${enc(id)}`, { method: 'POST', body: JSON.stringify({ choice, remember }) }),
    undo: () => c.request('/api/approvals/undo', { method: 'POST', body: '{}' }),
  };
}
