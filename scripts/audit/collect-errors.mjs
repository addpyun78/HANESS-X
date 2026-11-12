// C1.8 실제 세션 events.jsonl의 오류 이벤트 수집 → raw/runtime-errors.json
// 대상: ~/.harness-x/sessions/*/events.jsonl, ~/.harness-x/logs/sessions/*/events.jsonl (HARNESS_X_HOME 존중), 읽기만
// 오류 이벤트 = type이 error·*_rejected·*_failed 이거나 level=error. 종류·코드·엔진·메시지 앞 80자(비밀 마스킹)
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { existsSync, rawDir, readFileSync, root, writeJson } from './lib.mjs';
const { maskSecrets } = await import(
  pathToFileURL(join(root, 'packages', 'kernel', 'dist', 'secrets-mask.js')).href
);
const home = process.env.HARNESS_X_HOME ?? join(homedir(), '.harness-x');
const files = [];
for (const base of [join(home, 'sessions'), join(home, 'logs', 'sessions')]) {
  if (!existsSync(base)) continue;
  for (const d of readdirSync(base)) {
    const f = join(base, d, 'events.jsonl');
    if (existsSync(f)) files.push(f);
  }
}
const isErr = (e) =>
  e.type === 'error' || /_(rejected|failed|error)$/.test(e.type ?? '') || e.level === 'error';
const groups = new Map();
let total = 0;
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isErr(e)) continue;
    total++;
    const msg = maskSecrets(String(e.message ?? e.error ?? '')).slice(0, 80);
    const key = [
      e.type,
      e.code ?? '',
      e.engineId ?? e.pluginId ?? '',
      msg.replace(/\(([^)]*)\)$/, '(…)'),
    ].join(' | ');
    const g = groups.get(key) ?? {
      type: e.type,
      code: e.code ?? null,
      engine: e.engineId ?? null,
      plugin: e.pluginId ?? null,
      message: msg,
      count: 0,
      first: e.ts,
      last: e.ts,
    };
    g.count++;
    g.last = e.ts;
    groups.set(key, g);
  }
}
const list = [...groups.values()].sort((a, b) => b.count - a.count);
writeJson(join(rawDir, 'runtime-errors.json'), { files: files.length, errorEvents: total, groups: list });
// 키 패턴 0건 확인
const text = JSON.stringify(list);
const leaks = (
  text.match(
    /sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,}/g,
  ) ?? []
).length;
console.log(
  `runtime-errors: 로그 ${files.length}개, 오류 이벤트 ${total}개, 묶음 ${list.length}개, 키 패턴 ${leaks}건`,
);
