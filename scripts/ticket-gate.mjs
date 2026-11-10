#!/usr/bin/env node
// HARNESS-X 티켓 게이트 (Claude Code Stop 훅)
// - docs/tickets/*.md 중 `status: doing` 파일에 `- [ ]`가 남아 있으면 목록을 stderr에 쓰고 exit 2
//   (Claude Code는 Stop 훅의 exit 2를 "멈추지 말고 계속하라"로 처리)
// - 무한 반복 방지: stdin JSON의 stop_hook_active가 true이고 남은 수가 직전 실행과 같으면 exit 0
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
