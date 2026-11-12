#!/usr/bin/env node
// HARNESS-X 티켓 게이트 (Claude Code Stop 훅)
// - docs/tickets/*.md 중 `status: doing` 파일에 `- [ ]`가 남아 있으면 목록을 stderr에 쓰고 exit 2
//   (Claude Code는 Stop 훅의 exit 2를 "멈추지 말고 계속하라"로 처리)
// - 무한 반복 방지: stdin JSON의 stop_hook_active가 true이고 남은 수가 직전 실행과 같으면 exit 0
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ticketsDir = join(root, 'docs', 'tickets');
const stateDir = join(root, '.harness-x-dev');
const stateFile = join(stateDir, 'gate-last.json');

function readStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseInput(text) {
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function collectOpen() {
  const open = [];
  if (!existsSync(ticketsDir)) return open;
  for (const name of readdirSync(ticketsDir).sort()) {
    if (!name.endsWith('.md')) continue;
    const text = readFileSync(join(ticketsDir, name), 'utf8');
    if (!/^status:\s*doing\s*$/m.test(text)) continue;
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*- \[ \]/.test(line)) open.push(`${name}: ${line.trim()}`);
    }
  }
  return open;
}

function readLast() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

const input = parseInput(readStdin());

// T-102 C.2 진단(C·D) 단계 동안: docs/audit/phase 파일 내용이 C 또는 D면 읽기 전용 가드를 실행해
// docs/audit/·scripts/audit/ 밖 변경이 있으면 멈추지 못하게(exit 2) 하고 이유를 알린다
try {
  const phase = readFileSync(join(root, 'docs', 'audit', 'phase'), 'utf8').trim();
  const guard = join(root, 'scripts', 'audit', 'guard-readonly.mjs');
  if (/^[CD]$/.test(phase) && existsSync(guard)) {
    const r = spawnSync(process.execPath, [guard], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) {
      process.stderr.write(
        `ticket-gate: 진단 단계(${phase})인데 허용 밖 변경이 있습니다. 되돌리고 계속하세요.\n${r.stderr}`,
      );
      process.exit(2);
    }
  }
} catch {
  /* phase 파일 없음 = 점검 진단 단계 아님 */
}
const open = collectOpen();
const last = readLast();

mkdirSync(stateDir, { recursive: true });
writeFileSync(stateFile, JSON.stringify({ remaining: open.length, ts: new Date().toISOString() }));

if (open.length === 0) process.exit(0);

if (input.stop_hook_active === true && last && last.remaining === open.length) {
  // 진척 없음 → 사람에게 넘긴다
  process.stderr.write(`ticket-gate: 진척 없음(남은 ${open.length}개). 사람에게 넘깁니다.\n`);
  process.exit(0);
}

process.stderr.write(
  `ticket-gate: 진행 중 티켓에 미완료 항목 ${open.length}개가 남았습니다. 계속 진행하세요.\n` +
    open.map((l) => `  ${l}`).join('\n') +
    '\n',
);
process.exit(2);
