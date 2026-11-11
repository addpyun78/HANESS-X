import type { Runner, SecretLike } from '@harness-x/installer';
import type { CandidateOs, InstallMethod } from '../candidate.js';

/**
 * P3-B.1 검색 공급자 플러그인 슬롯 `search`.
 * 매니페스트에는 `provides.tool: ["search.<id>"]`로 적는다 (stt와 같은 tool 하위 슬롯 방식).
 * 공급자는 정리된 검색어(능력 설명만, B.3)만 받는다. 실행·설치는 하지 않는다(읽기 전용 조회).
 */

export const SEARCH_TOOL_PREFIX = 'search.';

export type SearchProviderKind = 'package' | 'web';

/** 공급자가 돌려주는 날것의 결과 (finder가 ToolCandidate로 정규화) */
export interface RawHit {
  providerId: string;
  name: string;
  summary: string;
  /** 공식 홈페이지 (모르면 빈 문자열) */
  officialUrl: string;
  /** 이 정보를 실제로 읽은 곳 (패키지 페이지·검색 결과 주소) */
  sourceUrl: string;
  /** 패키지 저장소의 구조화된 정보인가 (B.5: free 판정은 이것 + 오픈소스 라이선스일 때만) */
  packageRepo: boolean;
  license?: string;
  installMethod?: InstallMethod;
  os?: CandidateOs[];
  lastRelease?: string;
  archived?: boolean;
  verifiedPublisher?: boolean;
  /** 공식 가격 페이지를 실제로 열어 본 결과 (checkPricingPage) */
  pricingPage?: PricingPageResult;
}

export interface PricingPageResult {
  url: string;
  tier: 'free' | 'freemium' | 'paid' | 'trial';
  note: string;
  checkedAt: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SearchContext {
  runner?: Runner;
  fetch?: FetchLike;
  secrets?: SecretLike;
  now: () => Date;
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly id: string;
  readonly kind: SearchProviderKind;
  /** 쉬운 말 이름 */
  readonly label: string;
  /** 쓸 수 있는가 (실행기·인터넷 조회·키가 있는가) */
  available(ctx: SearchContext): boolean | Promise<boolean>;
  search(query: string, ctx: SearchContext): Promise<RawHit[]>;
}

/** 매니페스트 provides.tool에서 검색 공급자 id 목록 */
export function searchProvidersOf(m: { provides: { tool?: readonly string[] | undefined } }): string[] {
  return (m.provides.tool ?? [])
    .filter((t) => t.startsWith(SEARCH_TOOL_PREFIX))
    .map((t) => t.slice(SEARCH_TOOL_PREFIX.length));
}

/** 공급자 레지스트리 (플러그인이 추가 공급자를 꽂는다) */
export class SearchProviderRegistry {
  private readonly items = new Map<string, SearchProvider>();
  register(p: SearchProvider): () => void {
    if (this.items.has(p.id)) throw new Error(`검색 공급자 id 중복: ${p.id}`);
    this.items.set(p.id, p);
    return () => this.items.delete(p.id);
  }
  get(id: string): SearchProvider | undefined {
    return this.items.get(id);
  }
  list(): SearchProvider[] {
    return [...this.items.values()];
  }
}
