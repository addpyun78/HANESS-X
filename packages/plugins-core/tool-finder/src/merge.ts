import type { ToolCandidate } from './candidate.js';
import type { ToolBudget } from './need.js';
import { mergePricing } from './pricing.js';

/**
 * P3-B.6 중복 병합 · 후보 2~5개 · free-first면 무료 후보를 최소 1개 넣으려 시도
 */

export const MIN_CANDIDATES = 2;
export const MAX_CANDIDATES = 5;
export const NO_FREE_NOTICE = '무료로 쓸 수 있는 걸 못 찾았어요.';
export const FEW_NOTICE = '알맞은 도구를 많이 찾지 못했어요.';

const TRUST_RANK = { 공식: 0, 일반: 1, 주의: 2 } as const;

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function mergeTwo(a: ToolCandidate, b: ToolCandidate): ToolCandidate {
  const methods = [...a.installMethods];
  for (const m of b.installMethods)
    if (!methods.some((x) => x.kind === m.kind && x.id === m.id)) methods.push(m);
  const trust =
    TRUST_RANK[a.trust.level] === TRUST_RANK[b.trust.level]
      ? { level: a.trust.level, reasons: [...new Set([...a.trust.reasons, ...b.trust.reasons])] }
      : TRUST_RANK[a.trust.level] > TRUST_RANK[b.trust.level]
        ? a.trust // 주의 쪽이 이긴다 (안전하게)
        : b.trust;
  return {
    ...a,
    summary: a.summary || b.summary,
    pricing: mergePricing(a.pricing, b.pricing),
    license: a.license !== 'unknown' ? a.license : b.license,
    officialUrl: a.officialUrl || b.officialUrl,
    installMethods: methods,
    os: [...new Set([...a.os, ...b.os])],
    maintenance: {
      lastRelease: later(a.maintenance.lastRelease, b.maintenance.lastRelease),
      archived: a.maintenance.archived || b.maintenance.archived,
    },
    trust,
    pros: [...new Set([...a.pros, ...b.pros])],
    cons: [...new Set([...a.cons, ...b.cons])],
    sources: [...new Set([...a.sources, ...b.sources])],
  };
}

/** 같은 도구(이름 열쇠 같음)를 하나로 합친다. 처음 나온 순서를 지킨다 */
export function mergeCandidates(list: readonly ToolCandidate[]): ToolCandidate[] {
  const byId = new Map<string, ToolCandidate>();
  for (const c of list) {
    const cur = byId.get(c.id);
    byId.set(c.id, cur ? mergeTwo(cur, c) : c);
  }
  return [...byId.values()];
}

export interface Selection {
  candidates: ToolCandidate[];
  notices: string[];
}

/**
 * 정렬된 후보에서 최대 5개를 고른다.
 *  - free-only: 무료만
 *  - free-first: 상위 5개에 무료가 없으면 뒤쪽 무료 후보 하나를 맨 끝 자리에 넣는다. 아예 없으면 안내 문구
 */
export function selectCandidates(ranked: readonly ToolCandidate[], budget: ToolBudget): Selection {
  const notices: string[] = [];
  const pool = budget === 'free-only' ? ranked.filter((c) => c.pricing.tier === 'free') : [...ranked];
  const picked = pool.slice(0, MAX_CANDIDATES);
  if (budget !== 'any' && !picked.some((c) => c.pricing.tier === 'free')) {
    const free = pool.find((c) => c.pricing.tier === 'free');
    if (free) picked.splice(Math.min(picked.length, MAX_CANDIDATES - 1), 1, free);
    else notices.push(NO_FREE_NOTICE);
  }
  if (picked.length < MIN_CANDIDATES && picked.length > 0) notices.push(FEW_NOTICE);
  return { candidates: picked, notices };
}
