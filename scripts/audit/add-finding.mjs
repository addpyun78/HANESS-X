// C.4 발견 추가(id 자동 부여 C<단계>-NNN, 스키마 검사)
// usage: node scripts/audit/add-finding.mjs <단계번호 1~6> '<JSON: area,severity,title,evidence[],features[],proposal,risk,effort>'
//        node scripts/audit/add-finding.mjs --remove <id>
//        또는 모듈로: import { addFinding } from './add-finding.mjs'
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditDir, readJson, writeJson } from './lib.mjs';
import { Finding, validate } from './findings-schema.mjs';

export const findingsFile = join(auditDir, 'findings.json');
export function load() {
  return readJson(findingsFile, { findings: [] });
}
export function addFinding(stage, f) {
  const doc = load();
  const prefix = `C${stage}-`;
  const max = doc.findings
    .filter((x) => x.id.startsWith(prefix))
    .reduce((m, x) => Math.max(m, Number(x.id.slice(3))), 0);
  const item = { status: 'open', features: [], ...f, id: `${prefix}${String(max + 1).padStart(3, '0')}` };
  const r = Finding.safeParse(item);
  if (!r.success)
    throw new Error(
      '스키마 오류: ' + r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  doc.findings.push(item);
  const v = validate(doc);
  if (!v.ok) throw new Error(v.errors.join('; '));
  writeJson(findingsFile, doc);
  return item.id;
}
export function removeFinding(id) {
  const doc = load();
  const n = doc.findings.length;
  doc.findings = doc.findings.filter((x) => x.id !== id);
  writeJson(findingsFile, doc);
  return n - doc.findings.length;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--remove') console.log(`removed ${removeFinding(process.argv[3])}`);
  else console.log(addFinding(Number(process.argv[2]), JSON.parse(process.argv[3])));
}
