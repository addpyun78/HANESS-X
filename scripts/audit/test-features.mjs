// B.22 pnpm test:features — 기능 태그(// @features F-xxx)가 붙은 테스트 파일만 실행
// usage: pnpm test:features [F-001 ...]   (기능 id를 주면 그 기능 테스트만)
// CPU 부담을 줄이려고 일꾼 4개, 타입 검사 끔(기능 동작만 확인)
import { spawnSync } from 'node:child_process';
import { root } from './lib.mjs';
import { taggedFiles } from './feature-tags.mjs';
const want = new Set(process.argv.slice(2).filter((a) => /^F-\d{3}$/.test(a)));
const files = [...taggedFiles()]
  .filter(([, ids]) => !want.size || ids.some((i) => want.has(i)))
  .map(([f]) => f);
if (!files.length) {
  console.error('test:features: 태그 붙은 테스트 파일이 없습니다');
  process.exit(1);
}
console.log(`test:features: 파일 ${files.length}개`);
const extra = process.argv.slice(2).filter((a) => a.startsWith('--'));
const r = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--typecheck.enabled=false', '--maxWorkers=4', ...extra, ...files],
  { cwd: root, stdio: 'inherit' },
);
process.exit(r.status ?? 1);
