import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokensToCss } from '../src/design/css.js';
import { tokens } from '../src/design/tokens.js';
import { buildWeb } from './build-helper.js';

describe('토큰 → CSS 변수', () => {
  it('원시·의미 변수와 라이트/다크/수동 토글 규칙 생성', () => {
    const css = tokensToCss(tokens);
    for (const v of [
      '--hx-neutral-100: #f7f7f8',
      '--hx-neutral-900: #141417',
      '--hx-accent:',
      '--hx-warning:',
      '--hx-space-6: 32px',
      '--hx-radius: 8px',
      '--hx-font-20: 20px',
      '--hx-bg:',
      '--hx-text:',
    ])
      expect(css).toContain(v);
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(":root:not([data-theme='light'])");
    expect(css).toContain(":root[data-theme='dark']");
  });
});

describe('빌드 산출 CSS', () => {
  let out: Awaited<ReturnType<typeof buildWeb>>;
  beforeAll(async () => {
    out = await buildWeb();
  }, 180_000);
  afterAll(() => out?.cleanup());

  it('dist/assets/*.css에 토큰 변수와 테마 규칙이 존재', () => {
    expect(out.css).toMatch(/--hx-neutral-100:\s*#f7f7f8/);
    expect(out.css).toMatch(/--hx-accent:\s*#5b6cff/);
    expect(out.css).toContain('--hx-bg:');
    expect(out.css).toContain('--hx-space-1:');
    expect(out.css).toContain('prefers-color-scheme:dark');
    expect(out.css).toMatch(/\[data-theme=(['"]?)dark\1\]/);
  });
});
