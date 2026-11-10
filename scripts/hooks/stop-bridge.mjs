#!/usr/bin/env node
// HARNESS-X 종료 차단 브리지 (T-028) — Claude Code / Codex Stop 훅에서 실행된다.
//   node stop-bridge.mjs --dir <세션 폴더>                 checklist.json을 직접 읽는다
//   node stop-bridge.mjs --status-url <url> [--token-file f] GET /api/checklist/:session/status
//   [--state <file>] 진척 비교 상태 (기본 <dir>/stop-bridge-state.json 또는 임시 폴더)
//   [--log <file>]   판단 기록 JSONL (ingestBridgeLog로 이벤트 로그에 옮긴다)
//   [--engine <id>] [--session <id>]
// stdin: 엔진 Stop 훅 입력 JSON ({ session_id, stop_hook_active, hook_event_name, … })
// 판단(checklist-ledger/src/stop-guard.ts decideStop과 동일):
//   미완료 항목 없음 → 통과(exit 0, 출력 없음)
//   stop_hook_active이고 직전 block 뒤 진척 없음 → 통과 (사람에게 넘김)
//   그 밖 → stdout {"decision":"block","reason":"다음 항목 …"} (exit 0)
// 상태를 읽지 못하면 엔진을 가두지 않도록 통과한다(fail-open, stderr에 사유).
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    dir: { type: 'string' },
    'status-url': { type: 'string' },
    'token-file': { type: 'string' },
    state: { type: 'string' },
    log: { type: 'string' },
    engine: { type: 'string' },
    session: { type: 'string' },
  },
});

function readStdin() {
  if (process.stdin.isTTY) return {};
  try {
    const t = readFileSync(0, 'utf8');
    return t.trim() ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}

const ACTIVE = new Set(['doing', 'verifying', 'failed']);

/** stop-guard.ts statusOf와 같은 계산 */
function statusFromChecklist(sessionId, c) {
  const items = c?.items ?? [];
  const rest = items.filter((i) => i.status !== 'done');
  const done = new Set(items.filter((i) => i.status === 'done').map((i) => i.id));
  const cur =
    items.find((i) => ACTIVE.has(i.status)) ??
    items.find((i) => i.status === 'todo' && (i.deps ?? []).every((d) => done.has(d)));
  const next = cur ?? rest.find((i) => i.status !== 'blocked') ?? null;
  const progressKey = c
    ? `v${c.version}:` + items.map((i) => `${i.id}=${i.status}/${(i.evidence ?? []).length}`).join(',')
    : 'none';
  return {
    sessionId,
    exists: !!c,
    remaining: rest.length,
    complete: rest.length === 0,
    progressKey,
    next: next
      ? {
          id: next.id,
          title: next.title,
          instruction:
            `다음 항목 ${next.id}: ${next.title} — 체크리스트에 미완료 항목 ${rest.length}개가 남았습니다. ` +
            `멈추지 말고 이 항목을 진행한 뒤 checklist.submit으로 증거를 제출하세요.`,
        }
      : null,
  };
}

async function loadStatus(sessionId) {
  if (opt['status-url']) {
    const headers = {};
    if (opt['token-file']) headers.authorization = `Bearer ${readFileSync(opt['token-file'], 'utf8').trim()}`;
    const res = await fetch(opt['status-url'], { headers });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return res.json();
  }
  if (!opt.dir) throw new Error('--dir 또는 --status-url이 필요합니다');
  const f = join(opt.dir, 'checklist.json');
  return statusFromChecklist(sessionId, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
}

function stateFile() {
  if (opt.state) return opt.state;
  if (opt.dir) return join(opt.dir, 'stop-bridge-state.json');
  const h = createHash('sha256')
    .update(opt['status-url'] ?? '')
    .digest('hex')
    .slice(0, 16);
  return join(tmpdir(), `hx-stop-bridge-${h}.json`);
}

function readState(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function record(rec) {
  if (!opt.log) return;
  mkdirSync(dirname(opt.log), { recursive: true });
  appendFileSync(opt.log, JSON.stringify(rec) + '\n');
}

const input = readStdin();
const stopHookActive = input.stop_hook_active === true;
const sessionId = opt.session ?? input.session_id ?? 'unknown';
let status;
try {
  status = await loadStatus(sessionId);
} catch (err) {
  process.stderr.write(`stop-bridge: 상태를 읽지 못해 통과합니다: ${err?.message ?? err}\n`);
  process.exit(0);
}

const sf = stateFile();
const last = readState(sf);
let decision;
let reason;
if (status.complete || !status.next) {
  decision = 'allow';
  reason = status.exists ? '모든 항목 완료' : '체크리스트 없음';
} else if (stopHookActive && last.lastBlockedKey === status.progressKey) {
  decision = 'allow';
  reason = `진척 없음(남은 ${status.remaining}개) — 사람에게 넘깁니다`;
} else {
  decision = 'block';
  reason = status.next.instruction;
}

mkdirSync(dirname(sf), { recursive: true });
writeFileSync(
  sf,
  JSON.stringify({
    lastBlockedKey: decision === 'block' ? status.progressKey : null,
    ts: new Date().toISOString(),
  }),
);
record({
  ts: new Date().toISOString(),
  sessionId,
  ...(opt.engine ? { engineId: opt.engine } : {}),
  decision,
  reason,
  remaining: status.remaining,
  ...(status.next ? { nextItemId: status.next.id } : {}),
  stopHookActive,
});

if (decision === 'block') process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
else process.stderr.write(`stop-bridge: ${reason}\n`);
process.exit(0);
