// 기능 태그 공통: 테스트 파일 맨 위 주석 `// @features F-001 F-002` (테스트 이름은 바꾸지 않는다)
import { join } from 'node:path';
import { listFiles, readFileSync, rel, root } from './lib.mjs';
export const TAG_RE = /^\/\/ @features ((?:F-\d{3}\s*)+)$/m;
export function testFiles() {
  return listFiles(root, (p) => /\.test\.tsx?$/.test(p), {
    skipDirs: ['node_modules', 'dist', '.git', '.claude', 'target', '.harness-x-dev'],
  }).map(rel);
}
/** 파일 → 기능 id 목록 */
export function taggedFiles() {
  const out = new Map();
  for (const f of testFiles()) {
    const head = readFileSync(join(root, f), 'utf8').slice(0, 2000);
    const m = head.match(TAG_RE);
    if (m) out.set(f, m[1].trim().split(/\s+/));
  }
  return out;
}
