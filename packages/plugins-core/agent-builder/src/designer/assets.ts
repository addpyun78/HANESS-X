import { draftAssetRefs, type AgentDraft, type DraftGap } from '@harness-x/protocol';
import type { Inventory } from '../inventory/schema.js';
import { normalizeDesignerEngineId } from './settings.js';

/**
 * P4-C.6 지어낸 자산 차단: 초안의 모든 skill/engine/tool/agent id가 인벤토리에 있는지 검사.
 * 없으면 "목록에 없는 id: …, 목록 안에서만 골라라"로 최대 2회 재요청(designer.ts),
 * 그래도 있으면 그 칸을 노드에서 빼고 gaps로 옮긴다(자동으로 새로 만들지 않는다).
 */

export const MAX_FABRICATION_RETRIES = 2;

export type AssetKind = 'skill' | 'tool' | 'engine' | 'agent';

export interface UnknownRef {
  kind: AssetKind;
  id: string;
  nodeId: string;
}

/** 인벤토리 id 집합 (스킬은 id·이름, 도구는 id·MCP 서버 도구 이름, 에이전트는 이름·명령) */
export function inventoryIds(inv: Inventory): Record<AssetKind, Set<string>> {
  return {
    skill: new Set(inv.skills.flatMap((s) => [s.id, s.name])),
    tool: new Set([
      ...inv.tools.flatMap((t) => [t.id, t.name]),
      ...inv.mcpServers.flatMap((m) => [m.id, ...m.tools.map((t) => t.name)]),
    ]),
    engine: new Set(inv.engines.flatMap((e) => [e.id, normalizeDesignerEngineId(e.binary)])),
    agent: new Set(inv.agents.flatMap((a) => [a.name, a.command])),
  };
}

export function findUnknownRefs(d: AgentDraft, inv: Inventory): UnknownRef[] {
  const ids = inventoryIds(inv);
  return draftAssetRefs(d).filter((r) => {
    const id = r.kind === 'engine' ? normalizeDesignerEngineId(r.id) : r.id;
    return !ids[r.kind].has(id);
  });
}

export function fabricationRetryMessage(unknown: readonly UnknownRef[]): string {
  const list = [...new Set(unknown.map((u) => `${u.kind} "${u.id}"`))].join(', ');
  return `목록에 없는 id: ${list}. 목록 안에서만 골라라 (choose only ids listed in INVENTORY; put missing capabilities in "gaps"). Reply with the full JSON draft again.`;
}

const KIND_WORD: Record<AssetKind, string> = { skill: '스킬', tool: '도구', engine: 'AI', agent: '에이전트' };

/** 목록에 없는 칸을 노드에서 빼고 빈 칸으로 옮긴다 */
export function moveUnknownToGaps(d: AgentDraft, unknown: readonly UnknownRef[]): AgentDraft {
  if (unknown.length === 0) return d;
  const bad = (kind: AssetKind, nodeId: string, id: string) =>
    unknown.some((u) => u.kind === kind && u.nodeId === nodeId && u.id === id);
  const nodes = d.nodes.map((n) => {
    const next = {
      ...n,
      skills: n.skills.filter((s) => !bad('skill', n.id, s)),
      tools: n.tools.filter((t) => !bad('tool', n.id, t)),
    };
    if (n.engine && bad('engine', n.id, n.engine)) delete next.engine;
    if (n.agent && bad('agent', n.id, n.agent)) delete next.agent;
    return next;
  });
  const taken = new Set(d.gaps.map((g) => g.id));
  const gaps: DraftGap[] = [...d.gaps];
  for (const u of unknown) {
    if (gaps.some((g) => g.missingId === u.id && g.nodeId === u.nodeId)) continue;
    let k = gaps.length + 1;
    while (taken.has(`gap-${k}`)) k++;
    taken.add(`gap-${k}`);
    gaps.push({
      id: `gap-${k}`,
      need: `목록에 없는 ${KIND_WORD[u.kind]} "${u.id}" 대신 쓸 기능이 필요해요.`,
      nodeId: u.nodeId,
      kind: u.kind,
      missingId: u.id,
      origin: 'unknown-id',
    });
  }
  return { ...d, nodes, gaps };
}
