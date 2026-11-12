// T-102 E.C1-008.1 재현: 화면 코드 편집기(monaco-editor)가 실제로 불러오는 dompurify가 보안 수정판(3.4.17 이상, 같은 큰 판 3)이어야 한다
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webPkg = fileURLToPath(new URL('../../package.json', import.meta.url));

function version(): string {
  const fromWeb = createRequire(webPkg);
  const monaco = fromWeb.resolve('monaco-editor/package.json');
  const fromMonaco = createRequire(monaco);
  return JSON.parse(readFileSync(fromMonaco.resolve('dompurify/package.json'), 'utf8')).version as string;
}

describe('dompurify 보안 수정판 (T-102 C1-008)', () => {
  it('monaco-editor가 쓰는 dompurify ≥ 3.4.17 이고 큰 판은 3', () => {
    const [maj, min, pat] = version().split('.').map(Number) as [number, number, number];
    expect(maj).toBe(3);
    expect(min > 4 || (min === 4 && pat >= 17)).toBe(true);
  });
});
