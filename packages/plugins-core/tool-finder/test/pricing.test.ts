import { describe, expect, it } from 'vitest';
import {
  checkPricingPage,
  decidePricing,
  isOpenSourceLicense,
  mergePricing,
  normalizeHits,
  PRICING_NOTES,
  type RawHit,
} from '../src/index.js';
import { fakeFetch, hit, NOW } from './helpers.js';

const page = (tier: 'paid' | 'trial' | 'freemium') => ({
  url: 'https://vendor.example.com/pricing',
  tier,
  note: '확인함',
  checkedAt: NOW.toISOString(),
});

describe('P3-B.5 무료/유료 판정 규칙', () => {
  it('① 패키지 저장소 + 오픈소스 라이선스 → free (출처·확인 시각 포함)', () => {
    const p = decidePricing(hit({ name: 'ffmpeg', license: 'LGPL-2.1-or-later' }), NOW)!;
    expect(p).toEqual({
      tier: 'free',
      note: PRICING_NOTES.free,
      sourceUrl: 'https://example.org/ffmpeg',
      checkedAt: NOW.toISOString(),
    });
    expect(isOpenSourceLicense('MIT OR Apache-2.0')).toBe(true);
    expect(isOpenSourceLicense('Freeware')).toBe(false);
    expect(isOpenSourceLicense('Proprietary')).toBe(false);
  });

  it('② 가격 페이지를 실제로 연 경우만 freemium·paid·trial, 출처는 그 페이지', () => {
    for (const tier of ['paid', 'trial', 'freemium'] as const) {
      const p = decidePricing(hit({ name: 'x', packageRepo: false, pricingPage: page(tier) }), NOW)!;
      expect(p.tier).toBe(tier);
      expect(p.sourceUrl).toBe('https://vendor.example.com/pricing');
    }
  });

  it('③ 출처 없음·정보 충돌 → unknown, 출처 주소가 아예 없으면 후보 아님', () => {
    // 웹 결과가 "free"라고 말해도 추정으로 free 금지
    const web = hit({
      name: 'Free Video Tool',
      summary: '100% free forever',
      packageRepo: false,
      license: 'MIT',
    });
    expect(decidePricing(web, NOW)!.tier).toBe('unknown');
    // 저장소에 있지만 라이선스 없음 / 비오픈소스
    expect(decidePricing(hit({ name: 'a' }), NOW)!.tier).toBe('unknown');
    expect(decidePricing(hit({ name: 'b', license: 'Freeware' }), NOW)!.tier).toBe('unknown');
    // 오픈소스인데 가격 페이지는 유료 → 충돌
    const c = decidePricing(hit({ name: 'c', license: 'MIT', pricingPage: page('paid') }), NOW)!;
    expect(c).toMatchObject({ tier: 'unknown', note: PRICING_NOTES.conflict });
    expect(decidePricing(hit({ name: 'd', sourceUrl: '', officialUrl: '' }), NOW)).toBeUndefined();
    // 병합 충돌
    const free = decidePricing(hit({ name: 'e', license: 'MIT' }), NOW)!;
    const paid = decidePricing(hit({ name: 'e', packageRepo: false, pricingPage: page('paid') }), NOW)!;
    expect(mergePricing(free, paid).tier).toBe('unknown');
    expect(mergePricing(free, { ...free, tier: 'unknown' }).tier).toBe('free');
  });

  it('출처 없는 free 0건: 섞인 결과 200개 전부 검사', () => {
    const hits: RawHit[] = [];
    const licenses = ['MIT', 'GPL-3.0', 'Freeware', undefined, 'Proprietary', 'Apache-2.0'];
    for (let i = 0; i < 200; i++)
      hits.push(
        hit({
          name: `tool${i}`,
          packageRepo: i % 3 !== 0,
          ...(licenses[i % 6] ? { license: licenses[i % 6]! } : {}),
          summary: i % 2 ? 'free and open source' : '',
          sourceUrl: i % 7 === 0 ? '' : `https://repo.example.org/p/${i}`,
          officialUrl: i % 7 === 0 && i % 2 ? 'https://site.example.org' : '',
        }),
      );
    const cands = normalizeHits(hits, NOW);
    expect(cands.length).toBeGreaterThan(100);
    for (const c of cands) {
      expect(c.pricing.sourceUrl).toMatch(/^https:\/\//);
      expect(c.pricing.checkedAt).toBe(NOW.toISOString());
    }
    const free = cands.filter((c) => c.pricing.tier === 'free');
    expect(free.length).toBeGreaterThan(0);
    for (const c of free) {
      const src = hits.find((h) => h.name === c.name)!;
      expect(src.packageRepo && isOpenSourceLicense(src.license)).toBe(true);
    }
  });

  it('공식 가격 페이지 확인: 실제로 읽은 페이지만 판정, 못 읽으면 undefined', async () => {
    const f = fakeFetch({
      'https://paid.example.com/pricing': '<h1>Plans</h1><p>US$22.99/mo</p>',
      'https://trial.example.com/pricing': '<p>Start your free trial. Then $9 per month</p>',
      'https://fm.example.com/pricing': '<p>Free plan</p><p>Pro $5/month</p>',
    });
    expect((await checkPricingPage(f, 'https://paid.example.com/products/x', NOW))?.tier).toBe('paid');
    expect((await checkPricingPage(f, 'https://trial.example.com', NOW))?.tier).toBe('trial');
    expect((await checkPricingPage(f, 'https://fm.example.com', NOW))?.tier).toBe('freemium');
    expect(await checkPricingPage(f, 'https://none.example.com', NOW)).toBeUndefined();
    expect(await checkPricingPage(f, '', NOW)).toBeUndefined();
  });
});
