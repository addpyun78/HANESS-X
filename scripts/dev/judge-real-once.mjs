#!/usr/bin/env node
// T-100 P1-G.7 실제 1회 판정 (사람이 직접 실행 — 실제 엔진을 1~3번 부른다)
//
//   pnpm -r build
//   node scripts/dev/judge-real-once.mjs --engine claude-code      # 평소 쓰는 엔진 (claude-code | codex | antigravity)
//   node scripts/dev/judge-real-once.mjs                            # ~/.harness-x/settings.json 의 judge.engine 사용
//   옵션: --samples 1..3 (기본 설정값 또는 3) · --expected <글> · --actual <글> · --out <파일> (결과 JSON 저장)
//
// "완료" vs "작업이 끝났습니다"를 judge 체인(① judge.engine → ② 로컬 Ollama → ③ 구독 엔진 → ④ 승인 카드)에 묻고
// 결과·걸린 시간·판정 엔진을 출력한다. 엔진 인증 모드는 ~/.harness-x/engines-settings.yaml(없으면 구독)을 따른다.
// 이 스크립트는 엔진 자격 증명 파일을 읽지 않는다 — 엔진 CLI가 스스로 로그인 상태를 쓴다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = (rel) => {
  const f = join(repo, rel);
  if (!existsSync(f)) {
    console.error(`빌드된 파일이 없습니다: ${rel} — 먼저 pnpm -r build`);
    process.exit(2);
  }
  return import(pathToFileURL(f).href);
};

const { values } = parseArgs({
  options: {
    engine: { type: 'string' },
    samples: { type: 'string' },
    expected: { type: 'string', default: '완료' },
    actual: { type: 'string', default: '작업이 끝났습니다' },
    out: { type: 'string' },
  },
});

const judgeMod = await dist('packages/plugins-core/verifiers/judge/dist/index.js');
const kernel = await dist('packages/kernel/dist/index.js');

const home = process.env.HARNESS_X_HOME ?? join(homedir(), '.harness-x');
const settingsFile = join(home, 'settings.json');
const fileSettings = existsSync(settingsFile)
  ? (JSON.parse(readFileSync(settingsFile, 'utf8')).judge ?? {})
  : {};
const settings = judgeMod.parseJudgeSettings({
  ...fileSettings,
  ...(values.engine ? { engine: values.engine } : {}),
  ...(values.samples ? { samples: Number(values.samples) } : {}),
});

let modes = {};
try {
  modes = kernel.loadEnginesSettings().engines;
} catch {
  modes = {};
}
const engineIds = ['claude-code', 'codex', 'antigravity'];
const enginesCache = join(home, 'engines.json');
const scanned = existsSync(enginesCache)
  ? (JSON.parse(readFileSync(enginesCache, 'utf8')).engines ?? [])
  : [];

/** 감지 결과(있으면) + 로그인 상태 명령(codex만 있음) — 모르면 감지된 엔진을 로그인으로 본다 */
async function listEngines() {
  const out = [];
  for (const id of engineIds) {
    const alias = { 'claude-code': 'claude', antigravity: 'agy' }[id] ?? id;
    const hit = scanned.find((e) => e.name === id || e.name === alias);
    const wanted = judgeMod.normalizeEngineId(settings.engine) === id;
    if (!hit && !wanted) continue;
    const login = await kernel.getLoginStatus(id).catch(() => ({ state: 'unknown' }));
    out.push({
      id,
      detected: true,
      loggedIn: login.state !== 'loggedOut',
      authMode: modes[id]?.mode ?? modes[alias]?.mode ?? 'subscription',
      ...(hit?.path ? { command: hit.path } : {}),
    });
  }
  return out;
}

const chain = judgeMod.createJudgeChain(settings, {
  listEngines,
  secretStore: new kernel.SecretStore(),
  ...(process.env.HARNESS_X_OLLAMA_URL ? { ollamaBaseUrl: process.env.HARNESS_X_OLLAMA_URL } : {}),
});
const sel = await chain.select();
const req = {
  kind: 'text',
  expected: values.expected,
  actual: values.actual,
  itemTitle: '완료 안내 문구 (T-100 G.7 실제 1회)',
  sessionId: 't100-g7-real',
};
const started = Date.now();
const outcome = await chain.judge(req);
const record = {
  ts: new Date().toISOString(),
  expected: req.expected,
  actual: req.actual,
  settings: { engine: settings.engine, model: settings.model, samples: settings.samples },
  selectedStep: sel.step,
  engineId: outcome.engineId ?? null,
  verdict: outcome.verdict,
  confidence: outcome.confidence,
  samples: outcome.samples ?? 0,
  differenceKind: outcome.differenceKind ?? null,
  plainReason: outcome.plainReason ?? null,
  reason: outcome.reason,
  elapsedMs: Date.now() - started,
};
console.log(JSON.stringify(record, null, 2));
console.log(
  `\n결과: ${record.verdict} (신뢰도 ${record.confidence.toFixed(2)}, 표본 ${record.samples}) · 엔진 ${record.engineId ?? '없음'} · ${record.elapsedMs}ms`,
);
if (values.out) {
  mkdirSync(dirname(resolve(values.out)), { recursive: true });
  writeFileSync(resolve(values.out), JSON.stringify(record, null, 2) + '\n');
  console.log(`저장: ${resolve(values.out)}`);
}
