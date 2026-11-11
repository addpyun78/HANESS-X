import type { Inventory } from './schema.js';
import { tokenize } from './text.js';

/**
 * P4-A.11 관련 자산 추리기 — 로컬 BM25 (외부 호출 없음).
 * 자산이 많을 때 요청 문장과 관련도 순 상위 N개(기본 40) + 엔진 전부 + 비교기·워크스페이스만 설계 AI에 넘긴다.
 */

export const DEFAULT_PICK_LIMIT = 40;

export type RankedKind = 'plugins' | 'skills' | 'tools' | 'mcpServers' | 'agents' | 'pipelines';
export const RANKED_KINDS: readonly RankedKind[] = [
  'plugins',
  'skills',
  'tools',
  'mcpServers',
  'agents',
  'pipelines',
];

export interface ScoredAsset {
  kind: RankedKind;
  id: string;
  score: number;
}

interface Doc {
  kind: RankedKind;
  id: string;
  index: number;
  tokens: string[];
}

const join = (...xs: (string | undefined | readonly string[])[]) =>
  xs.flatMap((x) => (x === undefined ? [] : Array.isArray(x) ? x : [x as string])).join(' ');

function docs(inv: Inventory): Doc[] {
  const out: Doc[] = [];
  const push = (kind: RankedKind, id: string, index: number, text: string) =>
    out.push({ kind, id, index, tokens: tokenize(text) });
  inv.plugins.forEach((p, i) =>
    push('plugins', p.id, i, join(p.id, p.displayName, p.description, p.slots, p.commands)),
  );
  inv.skills.forEach((s, i) => push('skills', s.id, i, join(s.id, s.name, s.description, s.tags)));
  inv.tools.forEach((t, i) => push('tools', t.id, i, join(t.id, t.name, t.kind, t.purpose, t.capabilities)));
  inv.mcpServers.forEach((m, i) =>
    push(
      'mcpServers',
      m.id,
      i,
      join(m.id, m.name, m.description, ...m.tools.map((t) => `${t.name} ${t.description}`)),
    ),
  );
  inv.agents.forEach((a, i) =>
    push(
      'agents',
      a.name,
      i,
      join(a.name, a.displayName, a.description, ...a.nodes.map((n) => join(n.label, n.skills, n.tools))),
    ),
  );
  inv.pipelines.forEach((p, i) =>
    push('pipelines', p.id, i, join(p.name, ...p.nodes.map((n) => join(n.label, n.skills, n.tools)))),
  );
  return out;
}

/** Okapi BM25 (k1=1.2, b=0.75). 영문 접두 일치(3자 이상)는 0.5 가중 */
export function bm25Scores(query: string, documents: readonly string[][], k1 = 1.2, b = 0.75): number[] {
  const q = [...new Set(tokenize(query))];
  const N = documents.length;
  if (N === 0 || q.length === 0) return documents.map(() => 0);
  const avgdl = documents.reduce((s, d) => s + d.length, 0) / N || 1;
  const match = (t: string, term: string) =>
    t === term
      ? 1
      : term.length >= 3 && (t.startsWith(term) || term.startsWith(t)) && t.length >= 3
        ? 0.5
        : 0;
  const df = new Map(
    q.map((term) => [term, documents.filter((x) => x.some((t) => match(t, term) > 0)).length]),
  );
  return documents.map((d) => {
    let score = 0;
    for (const term of q) {
      let tf = 0;
      for (const t of d) tf += match(t, term);
      if (tf === 0) continue;
      const n = df.get(term)!;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * d.length) / avgdl));
    }
    return score;
  });
}

export interface PickResult {
  /** 추린 인벤토리 (엔진·비교기·워크스페이스는 전부 유지) */
  inventory: Inventory;
  /** 뽑힌 자산과 점수 (높은 순) */
  picked: ScoredAsset[];
  /** 전체 후보 수 */
  total: number;
}

/**
 * 요청 문장과 관련도 순 상위 limit개. 자산 수가 limit 이하면 전부 그대로.
 * 동점은 원래 순서(안정 정렬).
 */
export function pickRelevant(inv: Inventory, request: string, limit = DEFAULT_PICK_LIMIT): PickResult {
  const all = docs(inv);
  const scores = bm25Scores(
    request,
    all.map((d) => d.tokens),
  );
  const ranked = all
    .map((d, i) => ({ d, score: scores[i]!, order: i }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit);
  const keep = new Map<RankedKind, Set<number>>(RANKED_KINDS.map((k) => [k, new Set<number>()]));
  for (const r of ranked) keep.get(r.d.kind)!.add(r.d.index);
  const filt = <T>(kind: RankedKind, xs: readonly T[]) => xs.filter((_, i) => keep.get(kind)!.has(i));
  return {
    inventory: {
      ...inv,
      plugins: filt('plugins', inv.plugins),
      skills: filt('skills', inv.skills),
      tools: filt('tools', inv.tools),
      mcpServers: filt('mcpServers', inv.mcpServers),
      agents: filt('agents', inv.agents),
      pipelines: filt('pipelines', inv.pipelines),
    },
    picked: ranked.map((r) => ({ kind: r.d.kind, id: r.d.id, score: r.score })),
    total: all.length,
  };
}
