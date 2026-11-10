import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWeb } from './build-helper.js';

describe('폰트 로컬 번들', () => {
  let out: Awaited<ReturnType<typeof buildWeb>>;
  beforeAll(async () => {
    out = await buildWeb();
  }, 180_000);
  afterAll(() => out?.cleanup());

  it('Pretendard·JetBrains Mono @font-face가 번들된 woff2만 가리킨다(외부 URL 없음)', () => {
    expect(out.css).toMatch(/font-family:\s*["']?Pretendard Variable/);
    expect(out.css).toMatch(/font-family:\s*["']?JetBrains Mono/);
    expect(out.assets.some((f) => /^PretendardVariable.*\.woff2$/.test(f))).toBe(true);
    expect(out.assets.some((f) => /^jetbrains-mono.*\.woff2$/.test(f))).toBe(true);
    const urls = [...out.css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]!.replace(/["']/g, ''));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).not.toMatch(/^(https?:)?\/\//);
    expect(out.html).not.toMatch(/https?:\/\//);
  });
});
