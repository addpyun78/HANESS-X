// A.16 패키지별 직접 의존성 수, 전체 설치 패키지 수 → baseline.json.deps
import { join, dirname } from 'node:path';
import { readdirSync } from 'node:fs';
import { listFiles, mergeOut, readJson, root, rel } from './lib.mjs';
const pkgs = listFiles(root, (p) => p.endsWith('package.json'), {
  skipDirs: ['node_modules', 'dist', '.git', '.claude', 'target', '.harness-x-dev'],
});
const perPackage = {};
for (const p of pkgs) {
  const j = readJson(p, {});
  const d = Object.keys(j.dependencies ?? {});
  const dd = Object.keys(j.devDependencies ?? {});
  perPackage[rel(dirname(p)) || '.'] = {
    dependencies: d.length,
    devDependencies: dd.length,
    external: [...d, ...dd].filter((n) => !n.startsWith('@harness-x/')).length,
  };
}
let installed = 0;
try {
  installed = readdirSync(join(root, 'node_modules', '.pnpm')).filter(
    (n) => n !== 'node_modules' && n !== 'lock.yaml' && !n.startsWith('.'),
  ).length;
} catch {
  /* pnpm 저장소 없음 */
}
const directExternal = new Set();
for (const p of pkgs) {
  const j = readJson(p, {});
  for (const n of [...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {})])
    if (!n.startsWith('@harness-x/')) directExternal.add(n);
}
mergeOut('deps', { installedPackages: installed, uniqueDirectExternal: directExternal.size, perPackage });
console.log(
  JSON.stringify({
    installedPackages: installed,
    uniqueDirectExternal: directExternal.size,
    packages: pkgs.length,
  }),
);
