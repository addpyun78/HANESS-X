// A.10 커버리지(json-summary) → 줄·분기·함수 % → baseline.json.coverage, raw/coverage-final.json 보관
import { join } from 'node:path';
import { copyFileSync, rmSync } from 'node:fs';
import { mergeOut, readJson, rawDir, root, run } from './lib.mjs';

const dir = join(root, '.harness-x-dev', 'coverage');
rmSync(dir, { recursive: true, force: true });
const r = run(
  'nice',
  [
    '-n',
    '15',
    'pnpm',
    'vitest',
    'run',
    '--maxWorkers=4',
    '--typecheck.enabled=false',
    '--coverage.enabled',
    '--coverage.provider=v8',
    '--coverage.reporter=json-summary',
    '--coverage.reporter=json',
    `--coverage.reportsDirectory=${dir}`,
    '--coverage.include=packages/**/src/**',
    '--coverage.include=apps/**/src/**',
    '--coverage.reportOnFailure',
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);
const sum = readJson(join(dir, 'coverage-summary.json'));
if (!sum) {
  console.error('coverage-summary.json 없음, 종료코드', r.status);
  process.exit(1);
}
copyFileSync(
  join(dir, 'coverage-final.json'),
  join(rawDir, process.env.AUDIT_OUT ? 'coverage-final.after.json' : 'coverage-final.json'),
);
const t = sum.total;
const v = {
  lines: t.lines.pct,
  branches: t.branches.pct,
  functions: t.functions.pct,
  statements: t.statements.pct,
  testExit: r.status,
};
mergeOut('coverage', v);
console.log(JSON.stringify(v));
