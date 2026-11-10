import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

export const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** apps/web을 임시 폴더로 프로덕션 빌드하고 산출 파일 목록·CSS 내용을 돌려준다 */
export async function buildWeb() {
  const outDir = mkdtempSync(join(tmpdir(), 'hx-web-build-'));
  await build({
    root: WEB_ROOT,
    configFile: join(WEB_ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  const assets = readdirSync(join(outDir, 'assets'));
  const css = assets
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(outDir, 'assets', f), 'utf8'))
    .join('\n');
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  return { outDir, assets, css, html, cleanup: () => rmSync(outDir, { recursive: true, force: true }) };
}
