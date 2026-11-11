import { KIND_PREFERENCE } from '@harness-x/installer';
import type { ToolCandidate } from './candidate.js';
import type { ToolBudget, UserOs } from './need.js';
import { osMatch } from './os.js';
import { budgetFit } from './pricing.js';

/**
 * P3-C.1 정렬: 신뢰 등급 > 예산 적합 > 설치 쉬움(winget·공식 마켓 우선) > OS 호환 > 최근 유지보수
 */

const TRUST_ORDER = { 공식: 0, 일반: 1, 주의: 2 } as const;

/** 설치 쉬움: 가장 쉬운 설치 방법의 순위 (설치 방법이 없으면 맨 뒤) */
export function installEase(c: Pick<ToolCandidate, 'installMethods'>): number {
  const idx = c.installMethods.map((m) => KIND_PREFERENCE.indexOf(m.kind)).filter((i) => i >= 0);
  return idx.length ? Math.min(...idx) : KIND_PREFERENCE.length + 1;
}

/** 최근 유지보수: 보관됨은 맨 뒤, 날짜가 없으면 그 앞 */
function maintenanceScore(c: ToolCandidate): number {
  if (c.maintenance.archived) return -2;
  const t = c.maintenance.lastRelease ? Date.parse(c.maintenance.lastRelease) : NaN;
  return Number.isFinite(t) ? t : -1;
}

export function compareCandidates(
  a: ToolCandidate,
  b: ToolCandidate,
  budget: ToolBudget,
  os: UserOs,
): number {
  return (
    TRUST_ORDER[a.trust.level] - TRUST_ORDER[b.trust.level] ||
    (budget === 'any' ? 0 : budgetFit(a.pricing.tier) - budgetFit(b.pricing.tier)) ||
    installEase(a) - installEase(b) ||
    osMatch(a, os) - osMatch(b, os) ||
    maintenanceScore(b) - maintenanceScore(a)
  );
}

export function rankToolCandidates(
  list: readonly ToolCandidate[],
  budget: ToolBudget,
  os: UserOs,
): ToolCandidate[] {
  return [...list].sort((a, b) => compareCandidates(a, b, budget, os));
}
