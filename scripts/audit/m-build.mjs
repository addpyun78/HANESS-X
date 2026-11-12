// A.11 pnpm -r build 3회 평균 시간 → baseline.json.buildSec
import { mergeOut, run } from './lib.mjs';
const n = Number(process.env.AUDIT_BUILD_RUNS || 3);
const times = [];
for (let k = 0; k < n; k++) {
  const t0 = Date.now();
  const r = run('nice', ['-n', '15', 'pnpm', '-r', '--workspace-concurrency=2', 'build']);
  if (r.status !== 0) {
    console.error(r.stdout.slice(-3000), r.stderr.slice(-3000));
    process.exit(1);
  }
  times.push((Date.now() - t0) / 1000);
}
const avg = Math.round((times.reduce((a, b) => a + b, 0) / n) * 10) / 10;
mergeOut('buildSec', { avg, runs: times });
console.log(JSON.stringify({ avg, runs: times }));
