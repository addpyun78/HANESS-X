import { readFileSync } from 'node:fs';
import type { ApprovalCardData } from '../src/panels/Approvals/model.js';

/** jsdom 환경에서도 쓰도록 URL.pathname으로 경로를 만든다 */
const here = (rel: string) => decodeURIComponent(new URL(rel, import.meta.url).pathname);

/** 저장소 fixtures/approvals/ (T-100 H.9) 카드 */
export function fixtureCard(name: string, patch: Partial<ApprovalCardData> = {}): ApprovalCardData {
  const file = here(`../../../fixtures/approvals/${name}.json`);
  return { ...(JSON.parse(readFileSync(file, 'utf8')) as ApprovalCardData), ...patch };
}

export const CSS_FILE = here('../src/panels/Approvals/approvals.css');

/** approval_request 이벤트 (approvals 플러그인 저장소가 내보내는 모양) */
export function requestEvent(card: ApprovalCardData, n = 1) {
  return {
    id: `ev-${card.id}-${n}`,
    ts: card.createdAt,
    sessionId: card.sessionId ?? 's-fixture',
    itemId: card.itemId,
    type: 'approval_request' as const,
    approvalId: card.id,
    kind: 'approval.card',
    title: card.title,
    detail: { card },
    options: card.options.map((o) => o.id),
  };
}

export function resolvedEvent(card: ApprovalCardData, choice = 'accept') {
  return {
    id: `res-${card.id}`,
    ts: card.createdAt,
    sessionId: card.sessionId ?? 's-fixture',
    type: 'approval_resolved',
    approvalId: card.id,
    choice,
  };
}
