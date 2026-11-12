// C1.14·C1.15 엔진 프로세스 목록(WSL ps + Windows tasklist) — 이름에 claude·codex·agy·gemini·ollama·fake-·acp 가 들어간 것
// usage: node scripts/audit/procs.mjs > 파일.json
import { spawnSync } from 'node:child_process';
const RE = /(claude|codex|agy|antigravity|gemini|ollama|fake-|acp|whisper)/i;
const ps = spawnSync('ps', ['-eo', 'pid,ppid,etimes,args'], { encoding: 'utf8' }).stdout.split('\n').slice(1);
const linux = ps
  .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
  .filter(Boolean)
  .map((m) => ({ pid: +m[1], ppid: +m[2], ageSec: +m[3], cmd: m[4].slice(0, 160) }))
  .filter(
    (p) =>
      RE.test(p.cmd) &&
      !/procs\.mjs|ps -eo|snapfuse|claude_agent_sdk|\.claude\/shell-snapshots|^claude$|node_modules\/.*vitest/.test(
        p.cmd,
      ),
  );
let windows = [];
const t = spawnSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 20000 });
if (t.status === 0)
  windows = t.stdout
    .split('\n')
    .map((l) => l.split('","')[0]?.replace(/^"/, ''))
    .filter((n) => n && RE.test(n));
console.log(JSON.stringify({ at: new Date().toISOString(), linux, windows }, null, 2));
