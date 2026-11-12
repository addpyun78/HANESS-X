// E.1 E 대상(버그·껍데기·보안·업데이트·문서) 추출 + 순서(치명 → 높음 → 껍데기 → 보안 → 업데이트 → 문서) → raw/e-queue.json
// F(통합·폴더)·G(안 쓰는 코드·용량)는 제외
import { join } from 'node:path';
import { auditDir, rawDir, readJson, writeJson } from './lib.mjs';
const approved = readJson(join(auditDir, 'approved.json')).approved;
const fs = readJson(join(auditDir, 'findings.json')).findings;
const E_AREAS = ['bug', 'shell', 'security', 'update', 'docs'];
const rank = (f) =>
  f.severity === 'critical'
    ? 0
    : f.severity === 'high'
      ? 1
      : f.area === 'bug'
        ? 1.5
        : f.area === 'shell'
          ? 2
          : f.area === 'security'
            ? 3
            : f.area === 'update'
              ? 4
              : f.area === 'docs'
                ? 5
                : 6;
const q = approved
  .map((a) => ({ ...a, f: fs.find((x) => x.id === a.id) }))
  .filter((a) => a.f && E_AREAS.includes(a.f.area))
  .sort((a, b) => rank(a.f) - rank(b.f) || a.id.localeCompare(b.id))
  .map((a, i) => ({
    order: i + 1,
    id: a.id,
    choice: a.choice,
    area: a.f.area,
    severity: a.f.severity,
    title: a.f.plain,
  }));
writeJson(join(rawDir, 'e-queue.json'), q);
console.log(`e-queue: ${q.length}개`);
for (const x of q) console.log(`  ${x.order}. ${x.id} ${x.choice} ${x.area}/${x.severity} ${x.title}`);
