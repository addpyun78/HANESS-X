import { CandidatePricingSchema, type CandidatePricing } from './candidate.js';
import type { RawHit } from './providers/types.js';

/**
 * P3-B.5 무료/유료 판정 규칙
 *   ① 패키지 저장소의 오픈소스 라이선스 → free
 *   ② 공식 가격 페이지를 실제로 열어 확인한 경우만 → freemium · paid · trial
 *   ③ 출처 없음 · 정보 충돌 → unknown
 * 추정으로 free 표시 금지. 모든 pricing에 sourceUrl·checkedAt 필수.
 */

/** 오픈소스 라이선스 (SPDX id, 대소문자 무시) */
const OSS_LICENSE =
  /^(MIT|Apache-2\.0|Apache 2\.0|BSD-[23]-Clause|BSD|ISC|0BSD|Unlicense|MPL-2\.0|Zlib|(L|A)?GPL-?[23](\.\d)?(-only|-or-later|\+)?|(L|A)?GPLv[23]\+?|LGPL-2\.1(-only|-or-later)?|BSL-1\.0|CC0-1\.0|Python-2\.0|PSF-2\.0|EPL-2\.0)$/i;

export function isOpenSourceLicense(id: string | undefined): boolean {
  if (!id) return false;
  // "MIT OR Apache-2.0" 같은 식은 모든 쪽이 오픈소스여야
  const parts = id
    .replace(/[()]/g, '')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((s) => s.trim());
  return parts.length > 0 && parts.every((p) => OSS_LICENSE.test(p));
}

export const PRICING_NOTES = {
  free: '오픈소스라 무료예요.',
  unknown: '무료인지 확인하지 못했어요.',
  conflict: '정보가 서로 달라서 무료인지 확인하지 못했어요.',
} as const;

function validUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u).toString();
  } catch {
    return undefined;
  }
}

/** 결과 하나의 가격 정보. 출처 주소가 없으면 undefined (후보로 쓰지 않는다) */
export function decidePricing(hit: RawHit, now: Date): CandidatePricing | undefined {
  const source = validUrl(hit.sourceUrl) ?? validUrl(hit.officialUrl);
  if (!source) return undefined;
  const checkedAt = now.toISOString();
  const repoFree = hit.packageRepo && isOpenSourceLicense(hit.license);
  const page = hit.pricingPage && validUrl(hit.pricingPage.url) ? hit.pricingPage : undefined;
  let p: CandidatePricing;
  if (repoFree && page && page.tier !== 'free')
    p = { tier: 'unknown', note: PRICING_NOTES.conflict, sourceUrl: source, checkedAt };
  else if (repoFree) p = { tier: 'free', note: PRICING_NOTES.free, sourceUrl: source, checkedAt };
  else if (page && page.tier !== 'free')
    p = { tier: page.tier, note: page.note, sourceUrl: validUrl(page.url)!, checkedAt: page.checkedAt };
  else p = { tier: 'unknown', note: PRICING_NOTES.unknown, sourceUrl: source, checkedAt };
  return CandidatePricingSchema.parse(p);
}

/** 같은 도구의 가격 정보 둘을 합친다: 서로 다른 확인된 등급이면 충돌 → unknown */
export function mergePricing(a: CandidatePricing, b: CandidatePricing): CandidatePricing {
  if (a.tier === b.tier) return a;
  if (a.tier === 'unknown') return b;
  if (b.tier === 'unknown') return a;
  return { tier: 'unknown', note: PRICING_NOTES.conflict, sourceUrl: a.sourceUrl, checkedAt: a.checkedAt };
}

/** 예산에 맞는가 (free-only는 free만, free-first·any는 모두) */
export function budgetFit(tier: CandidatePricing['tier']): number {
  return tier === 'free' ? 0 : tier === 'freemium' ? 1 : tier === 'unknown' ? 2 : tier === 'trial' ? 3 : 4;
}
