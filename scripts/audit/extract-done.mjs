// B.1 티켓 파일 목록 → raw/ticket-files.json
// B.2 완료 항목(- [x]) 추출(티켓·섹션·항목 번호·문장) → raw/done-items.json
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { rawDir, readFileSync, root, writeJson } from './lib.mjs';

const tdir = join(root, 'docs', 'tickets');
const files = readdirSync(tdir)
  .filter((n) => /^T-\d+\.md$/.test(n) && n !== 'T-102.md')
  .sort()
  .map((n) => `docs/tickets/${n}`);
files.push('docs/PLAN-v2.md');
writeJson(join(rawDir, 'ticket-files.json'), files);

const items = [];
for (const f of files) {
  const text = readFileSync(join(root, f), 'utf8');
  const ticket = f.match(/T-\d+/)?.[0] ?? 'PLAN-v2';
  let title = '';
  let section = '';
  let part = '';
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const h1 = line.match(/^# (.+)/);
    if (h1) title = h1[1].trim();
    const h2 = line.match(/^## (.+)/);
    if (h2) part = h2[1].trim();
    const h = line.match(/^#{2,3} (.+)/);
    if (h) section = h[1].trim();
    const m = line.match(/^\s*- \[x\] (\S+)\s+(.*)$/);
    if (m) {
      // 바로 아래 '  - 결과:' 줄들(증거)도 함께 담는다 → 코드·테스트 연결에 쓴다
      const result = [];
      for (let k = li + 1; k < lines.length && /^\s{2,}\S/.test(lines[k]); k++) result.push(lines[k].trim());
      items.push({
        ticket,
        title,
        part,
        section,
        id: m[1],
        text: m[2].trim(),
        result: result.join(' ').slice(0, 2000),
      });
    }
  }
}
writeJson(join(rawDir, 'done-items.json'), items);
console.log(JSON.stringify({ files: files.length, doneItems: items.length }));
