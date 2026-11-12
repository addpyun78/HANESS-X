// T-102 E.C1-008.1 재현: 화면 코드 편집기(monaco-editor)가 실제로 불러오는 dompurify가 보안 수정판(3.4.17 이상, 같은 큰 판 3)이어야 한다
// monaco-editor는 exports 표 때문에 package.json을 resolve할 수 없어, 설치된 실제 폴더(pnpm 링크)를 따라가 옆의 dompurify를 읽는다
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const web = fileURLToPath(new URL('../..', import.meta.url));

function version(): string {
  const monaco = realpathSync(join(web, 'node_modules', 'monaco-editor'));
  const pkg = join(dirname(monaco), 'dompurify', 'package.json');
  return (JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version;
}

describe('dompurify 보안 수정판 (T-102 C1-008)', () => {
  it('monaco-editor가 쓰는 dompurify ≥ 3.4.17 이고 큰 판은 3', () => {
    const [maj, min, pat] = version().split('.').map(Number) as [number, number, number];
    expect(maj).toBe(3);
    expect(min > 4 || (min === 4 && pat >= 17)).toBe(true);
  });
});
