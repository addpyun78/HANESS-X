import type { AgentDraft } from '@harness-x/protocol';
import type { EngineAsset, Inventory } from '../inventory/schema.js';
import { normalizeDesignerEngineId } from './settings.js';

/**
 * P4-C.7 엔진 사용 가능 검사: needs-login·disabled 엔진이 지정되면 대체 엔진을 제안하고 이유를 쉬운 말로 적는다.
 * 제안만 한다 — 바꾸는 것은 사용자가 고른다(초안 점검표·요약 카드에 보인다).
 */

export interface EngineSuggestion {
  nodeId: string;
  engine: string;
  /** 대체 엔진 (쓸 수 있는 엔진이 없으면 undefined) */
  suggest: string | undefined;
  health: EngineAsset['health'];
  /** 쉬운 말 이유 */
  message: string;
}

export const engineById = (inv: Inventory, id: string): EngineAsset | undefined => {
  const k = normalizeDesignerEngineId(id);
  return inv.engines.find((e) => e.id === k || normalizeDesignerEngineId(e.binary) === k);
};

/** 바로 쓸 수 있는 엔진 id (인벤토리 순서) */
export const readyEngines = (inv: Inventory): string[] =>
  inv.engines.filter((e) => e.installed && e.health === 'ready').map((e) => e.id);

const WHY: Record<string, string> = {
  'needs-login': '로그인이 필요해서 지금은 쓸 수 없어요.',
  disabled: '꺼져 있어서 지금은 쓸 수 없어요.',
  outdated: '버전이 오래돼서 잘 안 될 수 있어요.',
};

export function checkDraftEngines(d: AgentDraft, inv: Inventory): EngineSuggestion[] {
  const ready = readyEngines(inv);
  const out: EngineSuggestion[] = [];
  for (const n of d.nodes) {
    if (!n.engine || n.engine === 'auto') continue;
    const e = engineById(inv, n.engine);
    if (!e || (e.health !== 'needs-login' && e.health !== 'disabled')) continue;
    // 같은 초안의 다른 노드가 이미 쓰는 준비된 엔진을 먼저, 없으면 첫 번째 준비된 엔진
    const used = d.nodes.map((x) => x.engine && normalizeDesignerEngineId(x.engine)).filter(Boolean);
    const suggest = ready.find((r) => used.includes(r)) ?? ready[0];
    out.push({
      nodeId: n.id,
      engine: e.id,
      suggest,
      health: e.health,
      message: suggest
        ? `"${e.id}"는 ${WHY[e.health]} 대신 "${suggest}"를 쓰면 어떨까요?`
        : `"${e.id}"는 ${WHY[e.health]} 쓸 수 있는 다른 AI가 없어요.`,
    });
  }
  return out;
}
