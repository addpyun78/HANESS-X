import { assertSafeQuery } from '../sanitize.js';
import { _http } from './package-repos.js';
import type { FetchLike, PricingPageResult, RawHit, SearchProvider } from './types.js';

/**
 * P3-B.1 ② 사용자 AI의 웹 검색 / ③ SearXNG(로컬, 선택) / ④ Brave Search API(키, 선택).
 * 웹 결과는 구조화돼 있지 않으므로 packageRepo=false (B.5: 가격 페이지를 실제로 열어 확인하기 전엔 unknown).
 */

export interface WebHit {
  title: string;
  url: string;
  snippet?: string;
}

/** 키체인 계정 이름 (Brave 키는 키체인에만) */
export const BRAVE_SECRET_ACCOUNT = 'brave-search';

/** 검색 결과 제목 → 도구 이름 ("HandBrake: The open source video transcoder" → "HandBrake") */
export function nameFromTitle(title: string): string {
  return (
    title
      .split(/\s+[-–—|:·]\s+|:\s/)[0]!
      .replace(/\s*(official site|download|공식 사이트)$/i, '')
      .trim() || title.trim()
  );
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function webHitToRaw(providerId: string, h: WebHit): RawHit {
  return {
    providerId,
    name: nameFromTitle(h.title),
    summary: h.snippet ?? '',
    officialUrl: originOf(h.url),
    sourceUrl: h.url,
    packageRepo: false,
  };
}

/** ② 사용자 AI의 웹 검색 기능 (엔진이 제공하는 검색을 주입) */
export function userAiWebProvider(ask: (query: string) => Promise<WebHit[]>): SearchProvider {
  return {
    id: 'user-ai-web',
    kind: 'web',
    label: '사용하는 AI의 웹 검색',
    available: () => true,
    async search(query) {
      const hits = await ask(assertSafeQuery(query)).catch(() => []);
      return hits.slice(0, 5).map((h) => webHitToRaw('user-ai-web', h));
    },
  };
}

/** ③ SearXNG (로컬 설치, 무료). baseUrl 예: http://localhost:8888 */
export function searxngProvider(baseUrl: string): SearchProvider {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    id: 'searxng',
    kind: 'web',
    label: '내 컴퓨터의 SearXNG 검색',
    available: (ctx) => Boolean(ctx.fetch && base),
    async search(query, ctx) {
      const q = assertSafeQuery(query);
      const r = await _http.getJson<{ results?: { title: string; url: string; content?: string }[] }>(
        ctx.fetch!,
        `${base}/search?q=${encodeURIComponent(q)}&format=json`,
        ctx.signal,
      );
      return (r?.results ?? []).slice(0, 5).map((x) =>
        webHitToRaw('searxng', {
          title: x.title,
          url: x.url,
          ...(x.content ? { snippet: x.content } : {}),
        }),
      );
    },
  };
}

/** ④ Brave Search API (키는 키체인 `brave-search`, 없으면 쓰지 않는다) */
export const braveProvider: SearchProvider = {
  id: 'brave',
  kind: 'web',
  label: 'Brave 검색',
  available: (ctx) => Boolean(ctx.fetch && ctx.secrets?.get(BRAVE_SECRET_ACCOUNT)),
  async search(query, ctx) {
    const q = assertSafeQuery(query);
    const key = ctx.secrets?.get(BRAVE_SECRET_ACCOUNT);
    if (!key || !ctx.fetch) return [];
    try {
      const res = await ctx.fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5`,
        {
          headers: { accept: 'application/json', 'X-Subscription-Token': key },
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        },
      );
      if (!res.ok) return [];
      const j = (await res.json()) as {
        web?: { results?: { title: string; url: string; description?: string }[] };
      };
      return (j.web?.results ?? []).slice(0, 5).map((x) =>
        webHitToRaw('brave', {
          title: x.title,
          url: x.url,
          ...(x.description ? { snippet: x.description } : {}),
        }),
      );
    } catch {
      return [];
    }
  },
};

// ── B.5 공식 가격 페이지 확인 ────────────────────────────────
/**
 * 공식 사이트의 가격 페이지를 실제로 읽어 등급을 정한다. 못 읽었거나 판단이 안 서면 undefined (→ unknown).
 * 주소는 공식 사이트(officialUrl)와 같은 곳만 읽는다.
 */
export async function checkPricingPage(
  f: FetchLike,
  officialUrl: string,
  now: Date,
  paths: readonly string[] = ['/pricing', '/plans'],
): Promise<PricingPageResult | undefined> {
  const origin = originOf(officialUrl);
  if (!origin) return undefined;
  for (const p of paths) {
    const url = `${origin}${p}`;
    const html = await _http.getText(f, url);
    if (!html) continue;
    const t = _http.htmlText(html).toLowerCase();
    const trial = /free trial|무료 체험|체험판|try (it )?free for \d+/.test(t);
    const price = /(\$|€|£|₩|us\$)\s?\d|\d+\s?(원|달러)|per month|\/mo\b|월 구독|\/month/.test(t);
    const freePlan = /free plan|free tier|free forever|\$0\b|무료 요금제|무료 플랜/.test(t);
    const checkedAt = now.toISOString();
    if (price && freePlan)
      return { url, tier: 'freemium', note: '기본은 무료, 일부 기능은 유료예요.', checkedAt };
    if (trial) return { url, tier: 'trial', note: '처음 얼마 동안만 무료로 써 볼 수 있어요.', checkedAt };
    if (price) return { url, tier: 'paid', note: '돈을 내야 쓸 수 있어요.', checkedAt };
  }
  return undefined;
}
