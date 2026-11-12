// C1.16 100턴 녹화 리플레이 전후 메모리(heapUsed·rss) → raw/memory.json
// C1.17 같은 리플레이 전후 열린 파일 수(/proc/self/fd) → raw/handles.json
// 방법: claude-code 어댑터를 실제 실행 경로(runLineProcess) 그대로 쓰되, 실행 파일을 'cat 녹화'로 바꿔
//  녹화(hi.real.jsonl)를 100턴 재생하고, 모든 이벤트를 EventLog에 기록한 뒤 replay로 다시 읽는다.
// usage: node --expose-gc scripts/audit/replay-mem.mjs [턴 수=100] [--out-suffix .after]
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rawDir, root, writeJson } from './lib.mjs';
const turns = Number(process.argv[2] ?? 100) || 100;
const suffix = process.argv.includes('--out-suffix')
  ? process.argv[process.argv.indexOf('--out-suffix') + 1]
  : '';
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { createClaudeCodeEngine } = await imp('packages/engines/claude-code/dist/index.js');
const { EventLog } = await imp('packages/kernel/dist/index.js');
const rec = join(root, 'packages/engines/claude-code/test/fixtures/hi.real.jsonl');
const fds = () => readdirSync('/proc/self/fd').length;
const mem = () => {
  globalThis.gc?.();
  const m = process.memoryUsage();
  return { heapUsed: m.heapUsed, rss: m.rss };
};
const dir = mkdtempSync(join(tmpdir(), 'hx-replay-'));
// 준비 실행 1턴(모듈 적재·첫 할당은 측정에서 뺀다)
const engine = createClaudeCodeEngine({ command: 'sh', prefixArgs: ['-c', `cat "${rec}"`, 'fake-claude'] });
const log = new EventLog({ root: dir });
async function turn(i) {
  const r = engine.run({ sessionId: 'replay', cwd: dir, permission: 'read-only', prompt: `턴 ${i}` });
  let n = 0;
  for await (const e of r.events) {
    log.append({ ...e, sessionId: 'replay' });
    n++;
  }
  await r.done;
  return n;
}
await turn(0);
await new Promise((r) => setTimeout(r, 200));
const m0 = mem();
const f0 = fds();
let events = 0;
const t0 = Date.now();
for (let i = 1; i <= turns; i++) events += await turn(i);
let replayed = 0;
for await (const _e of log.replay('replay')) replayed++;
log.flush?.();
await new Promise((r) => setTimeout(r, 500));
const m1 = mem();
const f1 = fds();
log.close();
rmSync(dir, { recursive: true, force: true });
const memory = {
  turns,
  events,
  replayed,
  ms: Date.now() - t0,
  before: m0,
  after: m1,
  diff: { heapUsed: m1.heapUsed - m0.heapUsed, rss: m1.rss - m0.rss },
  gc: !!globalThis.gc,
};
const handles = { turns, before: f0, after: f1, diff: f1 - f0 };
writeJson(join(rawDir, `memory${suffix}.json`), memory);
writeJson(join(rawDir, `handles${suffix}.json`), handles);
console.log(
  JSON.stringify({
    events,
    replayed,
    heapDiffMB: +(memory.diff.heapUsed / 1048576).toFixed(2),
    rssDiffMB: +(memory.diff.rss / 1048576).toFixed(2),
    fdDiff: handles.diff,
  }),
);
