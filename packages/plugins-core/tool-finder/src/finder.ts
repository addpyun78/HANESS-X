import type { Runner, SecretLike, ToolEntry } from '@harness-x/installer';
import type { ToolCandidate } from './candidate.js';
import { checkedLabel, SearchCache } from './cache.js';
import { ALREADY_HAVE_MESSAGE, matchRegistry } from './match.js';
import { ChoiceMemory, withPrevious } from './memory.js';
import { MAX_CANDIDATES, mergeCandidates, selectCandidates } from './merge.js';
import {
  parseToolNeed,
  type NeedSource,
  type RequiredBy,
  type ToolBudget,
  type ToolNeed,
  type UserOs,
} from './need.js';
import { filterByOs, currentUserOs } from './os.js';
import { PACKAGE_REPO_PROVIDERS } from './providers/package-repos.js';
import type { FetchLike, RawHit, SearchContext, SearchProvider } from './providers/types.js';
import {
  braveProvider,
  checkPricingPage,
  searxngProvider,
  userAiWebProvider,
  type WebHit,
} from './providers/web.js';
import { normalizeHits } from './normalize.js';
import { rankToolCandidates } from './rank.js';
import { installLabel, reasonsFor } from './reasons.js';
import { sanitizeQuery } from './sanitize.js';
import { parseToolsSettings, type ToolsSettings } from './settings.js';

/**
 * 도구 찾기 서비스 (Part 3 A~C 묶음)
 *   A.3 도구 목록 먼저 → B.3 검색어 정리 → B.8 캐시 → B.2 ① 패키지 저장소 → (부족하면) ② 웹 보충
 *   → B.5 가격 판정 → B.6 병합·2~5개 → B.7 OS 필터 → C.1 정렬 → C.7 지난번 선택 → C.2 이유
 * 설치는 하지 않는다. 사람이 카드에서 고르면 설치 관리자(Part 2) 계획 카드로 넘어간다.
 */

/** 패키지 저장소 결과가 이보다 적으면 웹 검색으로 보충 */
export const SUPPLEMENT_BELOW = 3;
/** 웹 결과 중 가격 페이지를 실제로 열어 볼 최대 수 */
export const PRICING_CHECK_LIMIT = 3;

export interface PickerCandidate extends ToolCandidate {
  reason: string;
  con: string;
  /** 카드 "설치:" 줄 */
  installLabel: string;
  /** "11/11 확인" */
  checkedLabel: string;
  /** ⭐ 추천 (정확히 1개) */
  recommended: boolean;
  /** 지난번에 고른 도구 */
  previous: boolean;
}

export type FindResult =
  | { status: 'have'; need: ToolNeed; tool: ToolEntry; message: string }
  | {
      status: 'candidates';
      need: ToolNeed;
      query: string;
      candidates: PickerCandidate[];
      recommendedId?: string;
      notices: string[];
      fromCache: boolean;
      /** 실제로 부른 공급자 id (부른 순서) */
      searched: string[];
    };

export interface NeedRequest {
  capability: string;
  why?: string;
  requiredBy?: RequiredBy;
  source?: NeedSource;
  constraints?: { os?: UserOs; offline?: boolean; budget?: ToolBudget };
}

export interface ToolFinderOptions {
  home: string;
  /** 도구 목록 (Part 2 F ToolRegistry) */
  registry?: { list(): ToolEntry[] };
  packageProviders?: readonly SearchProvider[];
  /** 웹 보충 공급자 (기본: buildWebProviders 결과) */
  webProviders?: readonly SearchProvider[];
  /** 사용자 AI의 웹 검색 (있으면 ② 공급자로 쓴다) */
  userAiSearch?: (query: string) => Promise<WebHit[]>;
  runner?: Runner;
  fetch?: FetchLike;
  secrets?: SecretLike;
  settings?: unknown;
  os?: UserOs;
  now?: () => Date;
  /** 웹 후보의 공식 가격 페이지를 열어 확인 (기본: fetch가 있으면 켬) */
  checkPricingPages?: boolean;
  events?: { append(ev: { type: string } & Record<string, unknown>): unknown };
}

/** 설정에 따라 ② 웹 보충 공급자 목록: 사용자 AI → SearXNG(설정 시) → Brave(켬 + 키) */
export function buildWebProviders(
  settings: ToolsSettings,
  userAiSearch?: (query: string) => Promise<WebHit[]>,
): SearchProvider[] {
  return [
    ...(userAiSearch ? [userAiWebProvider(userAiSearch)] : []),
    ...(settings.searxng ? [searxngProvider(settings.searxng)] : []),
    ...(settings.brave ? [braveProvider] : []),
  ];
}

export class ToolFinder {
  readonly settings: ToolsSettings;
  readonly os: UserOs;
  readonly cache: SearchCache;
  readonly memory: ChoiceMemory;
  private readonly packageProviders: readonly SearchProvider[];
  private readonly webProviders: readonly SearchProvider[];
  private readonly now: () => Date;

  constructor(private readonly o: ToolFinderOptions) {
    this.settings = parseToolsSettings(o.settings ?? {});
    this.os = o.os ?? currentUserOs();
    this.cache = new SearchCache(o.home);
    this.memory = new ChoiceMemory(o.home);
    this.packageProviders = o.packageProviders ?? PACKAGE_REPO_PROVIDERS;
    this.webProviders = o.webProviders ?? buildWebProviders(this.settings, o.userAiSearch);
    this.now = o.now ?? (() => new Date());
  }

  /** 요청 → ToolNeed (빈 제약은 현재 환경·설정으로 채운다) */
  need(req: NeedRequest): ToolNeed {
    return parseToolNeed({
      capability: req.capability,
      why: req.why ?? '',
      ...(req.requiredBy ? { requiredBy: req.requiredBy } : {}),
      source: req.source ?? 'user',
      constraints: {
        os: req.constraints?.os ?? this.os,
        offline: req.constraints?.offline ?? false,
        budget: req.constraints?.budget ?? this.settings.budget,
      },
    });
  }

  private ctx(): SearchContext {
    return {
      now: this.now,
      ...(this.o.runner ? { runner: this.o.runner } : {}),
      ...(this.o.fetch ? { fetch: this.o.fetch } : {}),
      ...(this.o.secrets ? { secrets: this.o.secrets } : {}),
    };
  }

  private async runProviders(
    list: readonly SearchProvider[],
    query: string,
    searched: string[],
  ): Promise<RawHit[]> {
    const ctx = this.ctx();
    const ready: SearchProvider[] = [];
    for (const p of list) if (await p.available(ctx)) ready.push(p);
    searched.push(...ready.map((p) => p.id));
    const res = await Promise.allSettled(ready.map((p) => p.search(query, ctx)));
    return res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }

  async find(req: NeedRequest | ToolNeed): Promise<FindResult> {
    const need = this.need(req);
    this.o.events?.append({ type: 'tool_need', capability: need.capability, source: need.source });

    // A.3 도구 목록 먼저
    const have = matchRegistry(need.capability, this.o.registry?.list() ?? []);
    if (have) return { status: 'have', need, tool: have, message: ALREADY_HAVE_MESSAGE };

    const query = sanitizeQuery(need.capability);
    const now = this.now();
    const budget = need.constraints.budget;
    const key = SearchCache.key(query, budget, need.constraints.os);
    const searched: string[] = [];
    let selected = this.cache.get(key, now);
    const fromCache = Boolean(selected);

    if (!selected) {
      // B.2 ① 패키지 저장소
      let pool = filterByOs(
        mergeCandidates(normalizeHits(await this.runProviders(this.packageProviders, query, searched), now)),
        need.constraints.os,
      );
      const enough =
        pool.length >= SUPPLEMENT_BELOW && (budget === 'any' || pool.some((c) => c.pricing.tier === 'free'));
      // ② 웹 검색으로 보충
      if (!enough && budget !== 'free-only' && this.webProviders.length) {
        const web = await this.runProviders(this.webProviders, query, searched);
        await this.checkPrices(web, now);
        pool = filterByOs(mergeCandidates([...pool, ...normalizeHits(web, now)]), need.constraints.os);
      }
      const sel = selectCandidates(rankToolCandidates(pool, budget, need.constraints.os), budget);
      this.cache.set(key, sel, now);
      selected = { at: now.toISOString(), ...sel };
    }

    // C.7 지난번 선택 맨 위
    const ranked = selected.candidates;
    const prev = withPrevious(ranked, this.memory.previous(need.capability));
    const list = prev.list.slice(0, MAX_CANDIDATES);
    const recommendedId = ranked[0]?.id;
    const candidates: PickerCandidate[] = list.map((c) => {
      const r = reasonsFor(c);
      return {
        ...c,
        reason: r.reason,
        con: r.con,
        installLabel: installLabel(c),
        checkedLabel: checkedLabel(c.pricing.checkedAt),
        recommended: c.id === recommendedId,
        previous: prev.previousIds.includes(c.id),
      };
    });
    this.o.events?.append({
      type: 'tool_candidates',
      capability: need.capability,
      count: candidates.length,
      fromCache,
    });
    return {
      status: 'candidates',
      need,
      query,
      candidates,
      ...(recommendedId ? { recommendedId } : {}),
      notices: selected.notices,
      fromCache,
      searched,
    };
  }

  /** B.5 웹 후보는 공식 가격 페이지를 실제로 열어 본 경우만 유료·체험판·무료+유료 */
  private async checkPrices(web: RawHit[], now: Date): Promise<void> {
    const f = this.o.fetch;
    if (!f || this.o.checkPricingPages === false) return;
    for (const h of web.filter((x) => x.officialUrl && !x.pricingPage).slice(0, PRICING_CHECK_LIMIT)) {
      const page = await checkPricingPage(f, h.officialUrl, now);
      if (page) h.pricingPage = page;
    }
  }

  /** C.7 선택 기록 */
  recordChoice(capability: string, chosen: readonly ToolCandidate[]): void {
    this.memory.record(capability, chosen, this.now());
  }
}
