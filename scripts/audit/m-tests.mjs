// A.9 전체 테스트 실행 → 테스트 수·통과·실패·건너뜀 → baseline.json.tests
// usage: node scripts/audit/m-tests.mjs [--from <vitest json 파일>]  (--from이면 다시 실행하지 않고 그 결과를 읽음)
import { join } from 'node:path';
import { mergeOut, readJson, rawDir, run, rel } from './lib.mjs';

export function summarize(r) {
  const failedNames = [];
  for (const f of r.testResults ?? [])
    for (const a of f.assertionResults ?? [])
      if (a.status === 'failed') failedNames.push(`${rel(f.name)} > ${a.fullName}`);
  // 파일 단위 실패(불러오기 오류 등)
  for (const f of r.testResults ?? [])
    if (f.status === 'failed' && !(f.assertionResults ?? []).some((a) => a.status === 'failed'))
      failedNames.push(`${rel(f.name)} (파일 실패: ${(f.message ?? '').slice(0, 120)})`);
  return {
    total: r.numTotalTests,
    passed: r.numPassedTests,
    failed: r.numFailedTests,
    skipped: (r.numPendingTests ?? 0) + (r.numTodoTests ?? 0),
    files: r.numTotalTestSuites,
    failedFiles: r.numFailedTestSuites,
    failedNames,
  };
}

const i = process.argv.indexOf('--from');
let file;
if (i > 0) file = process.argv[i + 1];
else {
  file = join(rawDir, `test-run-${Date.now()}.json`);
  run(
    'nice',
    ['-n', '15', 'pnpm', 'vitest', 'run', '--maxWorkers=4', '--reporter=json', `--outputFile=${file}`],
    { stdio: 'inherit' },
  );
}
const s = summarize(readJson(file));
mergeOut('tests', { ...s, source: rel(file) });
console.log(JSON.stringify({ total: s.total, passed: s.passed, failed: s.failed, skipped: s.skipped }));
