import type { ChecklistLedger } from '@harness-x/checklist-ledger';
import { pureCandidate } from './candidate.js';
import type { ToolFinder } from './finder.js';
import { continueWithoutTool, waitForTool, type AutoResume } from './flow.js';
import { parseToolNeed, type NeedSource } from './need.js';
import { planSelected, type PlanMaker } from './select.js';

/**
 * 커널 /api/tools/* 구현 (커널 ToolFinderApi 모양). 설치 실행은 하지 않는다 — /api/install/execute + 클릭 토큰으로만.
 */
export interface ToolFinderApiOptions {
  finder: ToolFinder;
  install: PlanMaker;
  auto?: AutoResume;
  /** 항목 상태를 바꿀 체크리스트 원장 (세션별) */
  ledger?: (sessionId?: string) => ChecklistLedger | undefined;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function createToolFinderApi(o: ToolFinderApiOptions) {
  return {
    async find(req: Record<string, unknown>) {
      const itemId = str(req.itemId);
      const nodeId = str(req.nodeId);
      const r = await o.finder.find({
        capability: str(req.capability),
        why: str(req.why),
        ...(itemId ? { requiredBy: { itemId } } : nodeId ? { requiredBy: { nodeId } } : {}),
        source: (str(req.source) || (nodeId ? 'agent-gap' : 'user')) as NeedSource,
      });
      const ledger = itemId ? o.ledger?.(str(req.sessionId) || undefined) : undefined;
      if (ledger && r.status === 'candidates') {
        const st = ledger.read()?.items.find((i) => i.id === itemId)?.status;
        if (st && st !== 'done') waitForTool(ledger, itemId, r.need);
      }
      return r;
    },

    async planSelected(req: Record<string, unknown>) {
      const need = parseToolNeed(req.need);
      const chosen = (Array.isArray(req.candidates) ? req.candidates : []).map((c) =>
        pureCandidate(c as object),
      );
      o.finder.recordChoice(need.capability, chosen);
      return { plans: await planSelected(o.install, need, chosen, o.auto) };
    },

    async continueWithout(req: Record<string, unknown>) {
      const need = parseToolNeed(req.need);
      const ledger = o.ledger?.(str(req.sessionId) || undefined);
      const itemId =
        str(req.itemId) || (need.requiredBy && 'itemId' in need.requiredBy ? need.requiredBy.itemId : '');
      if (!ledger || !itemId) return { status: 'no-item' };
      return req.possible === false
        ? continueWithoutTool(ledger, itemId, need, { possible: false, reason: str(req.reason) })
        : continueWithoutTool(ledger, itemId, need, { possible: true, alternative: str(req.alternative) });
    },
  };
}
