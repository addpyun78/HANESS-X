// B.25 기존 테스트 중 기능 대표 테스트에 태그 붙이기(기능당 최소 1개)
// 고르는 법: 기능에 연결된 테스트 중 1회차 실행(raw/test-run-1.json)에서 모두 통과한 파일만 후보.
//  문서(완료 항목 결과 줄)가 직접 언급한 파일을 우선, 그다음 여러 기능을 한 번에 덮는 작은 파일(탐욕적 집합 덮기)
// 태그: 파일 맨 위(// @vitest-environment 줄 다음)에 `// @features F-001 F-002` 한 줄
import { join } from 'node:path';
import { statSync, writeFileSync } from 'node:fs';
import { auditDir, rawDir, readFileSync, readJson, rel, root } from './lib.mjs';
import { TAG_RE, taggedFiles } from './feature-tags.mjs';

const map = readJson(join(auditDir, 'feature-map.json'));
const run1 = readJson(join(rawDir, 'test-run-1.json'));
const passing = new Set(
  run1.testResults
    .filter((f) => f.status === 'passed' && f.assertionResults.some((a) => a.status === 'passed'))
    .map((f) => rel(f.name)),
);
const already = taggedFiles();
const covered = new Set([...already.values()].flat());
const done = readJson(join(rawDir, 'done-items.json'), []);
const sizes = new Map();
const size = (f) => {
  if (!sizes.has(f)) sizes.set(f, statSync(join(root, f)).size);
  return sizes.get(f);
};
const plan = new Map(); // file → Set(feature)
const need = map.features.filter((f) => !covered.has(f.id) && f.status !== '준비 중');
const cand = new Map(need.map((f) => [f.id, f.tests.filter((t) => passing.has(t))]));
// 1) 문서가 직접 언급한 파일 (--greedy-only면 건너뜀: 파일 수를 줄여 실행 시간 단축)
for (const f of process.argv.includes('--greedy-only') ? [] : need) {
  const text = done
    .filter(
      (d) =>
        d.ticket === f.sources[0].ticket &&
        (!/^T-10\d$/.test(d.ticket) || d.section === f.sources[0].section),
    )
    .map((d) => d.result)
    .join(' ');
  const direct = cand.get(f.id).filter((t) => text.includes(t.split('/').pop()));
  if (direct.length) {
    const pick = direct.sort((a, b) => size(a) - size(b))[0];
    if (!plan.has(pick)) plan.set(pick, new Set());
    plan.get(pick).add(f.id);
    covered.add(f.id);
  }
}
// 2) 나머지: 탐욕적 집합 덮기(덮는 기능 수 / 크기)
for (;;) {
  const left = need.filter((f) => !covered.has(f.id));
  if (!left.length) break;
  const score = new Map();
  for (const f of left) for (const t of cand.get(f.id)) score.set(t, (score.get(t) ?? 0) + 1);
  if (!score.size) break;
  const best = [...score.entries()].sort(
    (a, b) => b[1] / Math.log2(size(b[0]) + 2) - a[1] / Math.log2(size(a[0]) + 2),
  )[0][0];
  if (!plan.has(best)) plan.set(best, new Set());
  for (const f of left)
    if (cand.get(f.id).includes(best)) {
      plan.get(best).add(f.id);
      covered.add(f.id);
    }
}
const uncovered = need.filter((f) => !covered.has(f.id)).map((f) => f.id);
if (process.argv.includes('--dry')) {
  console.log(JSON.stringify({ files: plan.size, uncovered }));
  process.exit(0);
}
for (const [file, ids] of plan) {
  const p = join(root, file);
  const lines = readFileSync(p, 'utf8').split('\n');
  const existing = lines.findIndex((l) => TAG_RE.test(l));
  if (existing >= 0) {
    const cur = new Set(lines[existing].replace('// @features ', '').trim().split(/\s+/));
    ids.forEach((i) => cur.add(i));
    lines[existing] = `// @features ${[...cur].sort().join(' ')}`;
  } else {
    const at = lines[0]?.startsWith('// @vitest-environment') ? 1 : 0;
    lines.splice(at, 0, `// @features ${[...ids].sort().join(' ')}`);
  }
  writeFileSync(p, lines.join('\n'));
}
console.log(
  JSON.stringify({
    taggedFiles: plan.size,
    features: [...plan.values()].reduce((a, s) => a + s.size, 0),
    uncovered,
  }),
);
