import type { HarnessApiClient } from '../../api/client.js';
import type { ApprovalDecision, ChecklistView } from './model.js';

/** 체크리스트 패널이 쓰는 커널 라우트 (checklist-ledger plan-routes.ts · kernel POST /api/approvals/:id) */
export interface ChecklistApi {
  /** GET /api/checklist/:session */
  get(sessionId: string): Promise<ChecklistView>;
  /** POST /api/checklist/:session/lock — 린트 위반·이미 잠김·미등록 단어면 ApiError 409 */
  lock(sessionId: string): Promise<{ status: 'locked'; revision: number; artifacts: Record<string, string> }>;
  /** POST /api/approvals/:id {decision} */
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<unknown>;
}

const enc = encodeURIComponent;

export function checklistApi(c: Pick<HarnessApiClient, 'request'>): ChecklistApi {
  return {
    get: (s) => c.request(`/api/checklist/${enc(s)}`),
    lock: (s) => c.request(`/api/checklist/${enc(s)}/lock`, { method: 'POST', body: '{}' }),
    resolveApproval: (id, decision) =>
      c.request(`/api/approvals/${enc(id)}`, { method: 'POST', body: JSON.stringify({ decision }) }),
  };
}
