// A.17 baseline.json → baseline.md 표 (AUDIT_OUT=final.json이면 final.json → final-metrics.md)
import { join } from 'node:path';
import { auditDir, readJson, writeFileSync, mb } from './lib.mjs';
const src = process.env.AUDIT_OUT || 'baseline.json';
const b = readJson(join(auditDir, src), {});
const rows = [];
const add = (k, v) => rows.push(`| ${k} | ${v ?? '—'} |`);
add(
  '테스트 수(전체/통과/실패/건너뜀)',
  b.tests && `${b.tests.total} / ${b.tests.passed} / ${b.tests.failed} / ${b.tests.skipped}`,
);
add(
  '커버리지 줄·분기·함수 %',
  b.coverage && `${b.coverage.lines} / ${b.coverage.branches} / ${b.coverage.functions}`,
);
add('빌드 시간(초, 평균)', b.buildSec && `${b.buildSec.avg} (${b.buildSec.runs.join(', ')})`);
add('웹 번들 크기 / gzip (MB)', b.bundle && `${mb(b.bundle.bytes)} / ${mb(b.bundle.gzip)}`);
add('서버 시작 → 첫 응답(ms, 평균)', b.startupMs && `${b.startupMs.avg} (${b.startupMs.runs.join(', ')})`);
add(
  '저장소 크기 MB(소스·node_modules·.git·나머지)',
  b.size && `${b.size.mb.source} · ${b.size.mb.nodeModules} · ${b.size.mb.git} · ${b.size.mb.other}`,
);
add('코드 파일 수 / 줄 수(빈 줄 제외)', b.lines && `${b.lines.total.files} / ${b.lines.total.lines}`);
add(
  '설치 패키지 수 / 직접 외부 의존성 수',
  b.deps && `${b.deps.installedPackages} / ${b.deps.uniqueDirectExternal}`,
);
add('흔들리는 테스트 수', b.flaky && b.flaky.length);
let md = `# ${src === 'baseline.json' ? '시작 수치 (정리 전)' : '최종 수치'}\n\n원본: docs/audit/${src} · 갱신 ${b.updatedAt ?? ''}\n\n| 항목 | 값 |\n| --- | --- |\n${rows.join('\n')}\n`;
if (b.lines) {
  md += `\n## 패키지별 코드\n\n| 패키지 | 파일 | 줄 |\n| --- | --- | --- |\n`;
  for (const [k, v] of Object.entries(b.lines.packages))
    if (v.files) md += `| ${k} | ${v.files} | ${v.lines} |\n`;
}
const out = src === 'baseline.json' ? 'baseline.md' : 'final-metrics.md';
writeFileSync(join(auditDir, out), md);
console.log(`wrote docs/audit/${out} (${rows.length}행)`);
