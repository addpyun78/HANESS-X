// 워크스페이스 패키지(@harness-x/*)의 src/index.ts 경로를 tsconfig.test.json paths에 동기화한다.
// 패키지를 추가하면 실행: node scripts/dev/sync-aliases.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { listWorkspacePackages } from './workspace-packages.mjs';

const paths = {};
for (const p of listWorkspacePackages()) paths[p.name] = [`./${p.rel}/src/index.ts`];
const file = 'tsconfig.test.json';
const t = JSON.parse(readFileSync(file, 'utf8'));
t.compilerOptions.paths = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(file, JSON.stringify(t, null, 2) + '\n');
console.log(`synced ${Object.keys(paths).length} aliases`);
