// E·F·G 처리 결과를 findings.json에 기록: node scripts/audit/set-status.mjs <id> <fixed|implemented|hidden|merged|deleted|"보류: 이유"> [메모]
import { join } from 'node:path';
import { auditDir, readJson, writeJson } from './lib.mjs';
const [id, status, note] = process.argv.slice(2);
const f = join(auditDir, 'findings.json');
const d = readJson(f);
const x = d.findings.find((y) => y.id === id);
if (!x) throw new Error(`없는 발견: ${id}`);
x.status = status;
if (note) x.meta = { ...(x.meta ?? {}), resolution: note, resolvedAt: new Date().toISOString() };
writeJson(f, d);
console.log(`${id} → ${status}`);
