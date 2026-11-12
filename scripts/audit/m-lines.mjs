// A.15 패키지별 파일 수·코드 줄 수 → baseline.json.lines
import { join, dirname } from 'node:path';
import { listFiles, mergeOut, readFileSync, root, rel } from './lib.mjs';
const pkgs = listFiles(root, (p) => p.endsWith('package.json'), {
  skipDirs: ['node_modules', 'dist', '.git', '.claude', 'target', '.harness-x-dev'],
})
  .map((p) => dirname(p))
  .filter((d) => d !== root);
const code = /\.(ts|tsx|js|mjs|cjs|css|rs)$/;
const out = {};
let files = 0;
let lines = 0;
for (const d of pkgs) {
  const fs = listFiles(join(d, 'src'), (p) => code.test(p), { skipDirs: ['node_modules', 'dist', 'target'] });
  const tests = listFiles(d, (p) => /\.test\.(ts|tsx)$/.test(p), {
    skipDirs: ['node_modules', 'dist', 'target', 'src'],
  });
  let n = 0;
  for (const f of fs)
    n += readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '').length;
  out[rel(d)] = { files: fs.length, lines: n, testFilesOutsideSrc: tests.length };
  files += fs.length;
  lines += n;
}
mergeOut('lines', { total: { files, lines }, packages: out });
console.log(JSON.stringify({ files, lines, packages: Object.keys(out).length }));
