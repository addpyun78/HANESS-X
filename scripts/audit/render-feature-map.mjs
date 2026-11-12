// B.27 feature-map.json → feature-map.md (기능·진입점·코드·테스트·상태 표)
import { join } from 'node:path';
import { auditDir, readJson, writeFileSync } from './lib.mjs';
import { taggedFiles } from './feature-tags.mjs';
const map = readJson(join(auditDir, 'feature-map.json'));
const tagged = taggedFiles();
const rep = (id) => [...tagged].filter(([, ids]) => ids.includes(id)).map(([f]) => f);
const esc = (s) => String(s).replace(/\|/g, '\\|');
const cnt = (e) =>
  Object.entries(e)
    .filter(([, v]) => v.length)
    .map(([k, v]) => `${k} ${v.length}`)
    .join(', ') || '없음';
let md = `# 기능 지도 (지켜야 할 기능 목록)\n\n기능 ${map.features.length}개 · 진입점 없음 ${map.noEntry?.length ?? 0}개 · 테스트 없음 ${map.noTest?.length ?? 0}개 · 원본 docs/audit/feature-map.json\n\n`;
md += `"기능이 사라지지 않았다" = 이 표의 모든 기능의 대표 테스트(\`pnpm test:features\`)가 정리 전후로 똑같이 통과.\n\n`;
md += `| id | 기능 | 출처 | 진입점 | 코드(앞 2곳) | 테스트 수 | 대표 테스트(@features) | 상태 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n`;
for (const f of map.features) {
  const code = f.code
    .slice(0, 2)
    .map((c) => c.at)
    .join('<br>');
  md += `| ${f.id} | ${esc(f.name)} | ${esc(f.sources[0].ticket)} | ${cnt(f.entries)} | ${esc(code)} | ${f.tests.length} | ${esc(rep(f.id).slice(0, 2).join('<br>'))} | ${f.status} |\n`;
}
writeFileSync(join(auditDir, 'feature-map.md'), md);
console.log(`feature-map.md: ${map.features.length}행`);
