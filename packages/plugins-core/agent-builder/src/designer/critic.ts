import type { AgentDraft } from '@harness-x/protocol';
import type { Inventory } from '../inventory/schema.js';
import { readyEngines } from './engines.js';
import { normalizeDesignerEngineId } from './settings.js';

/**
 * P4-C.9 검사 담당 기본 규칙: 사용자가 따로 말하지 않으면 검사 담당(duty=check) 노드는
 * 작성 담당(duty=write) 노드와 다른 엔진으로 배정한다. 쓸 수 있는 엔진이 1개뿐이면 같은 엔진 + 안내.
 */

export interface CriticNotice {
  nodeId: string;
  engine: string;
  message: string;
  /** 'reassigned' = 다른 엔진으로 바꿈, 'single-engine' = 엔진이 하나뿐이라 그대로, 'user' = 사용자가 정함 */
  kind: 'reassigned' | 'single-engine' | 'user';
}

const ENGINE_WORDS: Readonly<Record<string, readonly string[]>> = {
  'claude-code': ['claude', 'claude-code', '클로드'],
  codex: ['codex', '코덱스'],
  antigravity: ['agy', 'antigravity'],
  gemini: ['gemini', '제미나이'],
};

/** "검사는 claude로" 같이 사용자가 검사 담당 엔진을 말했는가 */
export function userNamedCheckEngine(request: string, inv: Inventory): string | undefined {
  const sentences = request.split(/[.!?\n]|그리고|,/).filter((s) => /검사|검수|확인|리뷰/.test(s));
  for (const s of sentences) {
    const low = s.toLowerCase();
    for (const e of inv.engines) {
      const words = ENGINE_WORDS[e.id] ?? [e.id, e.binary];
      if (words.some((w) => low.includes(w.toLowerCase()))) return e.id;
    }
  }
  return undefined;
}

export function assignCriticEngines(
  d: AgentDraft,
  inv: Inventory,
  request: string,
): { draft: AgentDraft; notices: CriticNotice[] } {
  const notices: CriticNotice[] = [];
  const writers = new Set(
    d.nodes
      .filter((n) => n.duty === 'write' && n.engine && n.engine !== 'auto')
      .map((n) => normalizeDesignerEngineId(n.engine!)),
  );
  const ready = readyEngines(inv);
  const named = userNamedCheckEngine(request, inv);
  const nodes = d.nodes.map((n) => {
    if (n.duty !== 'check' || (n.kind !== 'role' && n.kind !== 'subagent')) return n;
    if (named) {
      notices.push({
        nodeId: n.id,
        engine: named,
        kind: 'user',
        message: `말씀하신 대로 검사는 "${named}"가 해요.`,
      });
      return { ...n, engine: named };
    }
    const cur = n.engine && n.engine !== 'auto' ? normalizeDesignerEngineId(n.engine) : undefined;
    if (cur && !writers.has(cur)) return n;
    const other = ready.find((r) => !writers.has(r));
    if (other) {
      notices.push({
        nodeId: n.id,
        engine: other,
        kind: 'reassigned',
        message: `검사는 고친 AI와 다른 "${other}"가 해서 더 객관적이에요.`,
      });
      return { ...n, engine: other };
    }
    const same = cur ?? ready[0] ?? [...writers][0];
    notices.push({
      nodeId: n.id,
      engine: same ?? '',
      kind: 'single-engine',
      message: '쓸 수 있는 AI가 하나뿐이라 같은 AI가 검사해요.',
    });
    return same ? { ...n, engine: same } : n;
  });
  return { draft: { ...d, nodes }, notices };
}
