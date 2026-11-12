// A.21 3회 결과가 다른 테스트 목록 → baseline.json.flaky
// (3회 모두 있는 테스트만 비교. 1회차 뒤 새로 넣은 B.23 테스트는 제외)
import { join } from 'node:path';
import { mergeOut, rawDir, readJson, rel } from './lib.mjs';
const runs = [1, 2, 3].map((n) => readJson(join(rawDir, `test-run-${n}.json`)));
const key = (f, a) => `${rel(f.name)} > ${a.fullName}`;
const maps = runs.map((r) => {
  const m = new Map();
  for (const f of r.testResults) {
    for (const a of f.assertionResults) m.set(key(f, a), a.status);
    if (f.status === 'failed' && !f.assertionResults.length) m.set(`${rel(f.name)} > (파일)`, 'failed');
  }
  return m;
});
const flaky = [];
for (const k of maps[0].keys()) {
  const s = maps.map((m) => m.get(k));
  if (s.some((x) => x === undefined)) continue;
  if (new Set(s).size > 1)
    flaky.push({
      test: k,
      statuses: s,
      durationsMs: runs.map((r) => {
        const [file] = k.split(' > ');
        const f = r.testResults.find((x) => rel(x.name) === file);
        return f?.assertionResults.find((a) => k.endsWith(a.fullName))?.duration ?? null;
      }),
    });
}
mergeOut('flaky', flaky);
console.log(
  `flaky: ${flaky.length}개 (1회 ${runs[0].numFailedTests}·2회 ${runs[1].numFailedTests}·3회 ${runs[2].numFailedTests} 실패)`,
);
for (const f of flaky)
  console.log(`  ${f.statuses.join('/')} ${f.test.slice(0, 150)} ${JSON.stringify(f.durationsMs)}`);
