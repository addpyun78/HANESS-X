// B.3 완료 항목을 섹션 제목 단위로 묶어 기능 목록 초안 → docs/audit/feature-map.json
// - T-0xx 티켓: 티켓 1개 = 기능 1개(티켓 제목)
// - T-100·T-101: ### 소제목 1개 = 기능 1개
// 이미 있는 feature-map.json의 연결 정보(entries·code·tests·status·extra)는 id가 같으면 보존한다.
import { join } from 'node:path';
import { auditDir, rawDir, readJson, writeJson } from './lib.mjs';

const items = readJson(join(rawDir, 'done-items.json'), []);
const prev = readJson(join(auditDir, 'feature-map.json'), { features: [] });
const prevById = new Map(prev.features.map((f) => [f.id, f]));
const groups = new Map();
for (const it of items) {
  const big = /^T-10\d$/.test(it.ticket);
  const key = big ? `${it.ticket}::${it.section}` : it.ticket;
  if (!groups.has(key))
    groups.set(key, {
      name: big
        ? `${it.part.replace(/\s*[—(].*$/, '').trim()} · ${it.section.replace(/^[A-Z0-9-]+\.\s*/, '').trim()}`
        : it.title.replace(/^T-\d+\s*/, '').trim(),
      sources: [{ ticket: it.ticket, section: big ? it.section : it.title }],
      items: [],
    });
  groups.get(key).items.push(it.id);
}
let n = 0;
const features = [];
for (const g of groups.values()) {
  const id = `F-${String(++n).padStart(3, '0')}`;
  const old = prevById.get(id);
  features.push({
    id,
    name: g.name,
    sources: g.sources,
    doneItems: g.items.length,
    entries: old?.entries ?? { actions: [], api: [], cli: [], mcp: [], hooks: [], settings: [] },
    code: old?.code ?? [],
    tests: old?.tests ?? [],
    status: old?.status ?? '정상',
  });
}
// B.4에서 화면 기준으로 보탠 기능(extra: true)은 그대로 이어 붙인다
for (const f of prev.features.filter((f) => f.extra)) features.push(f);
writeJson(join(auditDir, 'feature-map.json'), { ...prev, generatedAt: new Date().toISOString(), features });
console.log(JSON.stringify({ features: features.length, fromTickets: groups.size }));
