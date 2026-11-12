// C1.14·C1.15 전후 엔진 프로세스 비교 → 새로 생겨 남은 프로세스
// usage: node scripts/audit/procs-diff.mjs <before.json> <after.json> <out.json> [label]
import { readJson, writeJson } from './lib.mjs';
const [b, a, out, label = ''] = process.argv.slice(2);
const before = readJson(b);
const after = readJson(a);
const bp = new Set(before.linux.map((p) => p.pid));
const leftoverLinux = after.linux.filter((p) => !bp.has(p.pid));
const count = (l) => l.reduce((m, n) => ((m[n] = (m[n] ?? 0) + 1), m), {});
const bw = count(before.windows);
const aw = count(after.windows);
const leftoverWindows = Object.entries(aw)
  .filter(([n, c]) => c > (bw[n] ?? 0))
  .map(([n, c]) => ({ name: n, extra: c - (bw[n] ?? 0) }));
const r = {
  label,
  before: before.at,
  after: after.at,
  leftoverLinux,
  leftoverWindows,
  leftoverCount: leftoverLinux.length + leftoverWindows.reduce((s, x) => s + x.extra, 0),
};
writeJson(out, r);
console.log(
  `${label} 남은 프로세스 ${r.leftoverCount}개 (WSL ${leftoverLinux.length}, Windows ${leftoverWindows.length}종)`,
);
