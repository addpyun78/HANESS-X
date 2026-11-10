import { join } from 'node:path';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';
import { WEB_ROOT } from './build-helper.js';

const configFile = join(WEB_ROOT, '.stylelintrc.json');
const lint = (code: string, file = 'src/x.css') =>
  stylelint.lint({ code, codeFilename: join(WEB_ROOT, file), configFile });

describe('하드코딩 색 금지 린트', () => {
  it('hex·이름 색·rgb() 거부', async () => {
    for (const code of ['a { color: #fff; }', 'a { color: red; }', 'a { color: rgb(0 0 0); }']) {
      const r = await lint(code);
      expect(r.errored, code).toBe(true);
    }
  });

  it('토큰 변수와 color-mix(var())는 허용', async () => {
    const r = await lint(
      'a { color: var(--hx-text); background: color-mix(in srgb, var(--hx-accent) 10%, var(--hx-bg)); }',
    );
    expect(r.errored).toBe(false);
  });

  it('tokens 파일만 예외', async () => {
    const r = await lint(':root { --x: #fff; }', 'src/design/tokens.css');
    expect(r.errored).toBe(false);
    expect(r.results[0]?.ignored).toBe(true);
  });
});
