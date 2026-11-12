// A.24~A.27 엔진 스모크: 짧은 작업 1회("README 첫 줄을 읽고 한 문장으로 요약") → raw/smoke-<이름>.json
// usage: node scripts/audit/smoke-engine.mjs <claude|codex|agy|local> [--out <파일>]
// 엔진이 설치 안 됐으면 { installed: false, result: '없음' }. 읽기 전용 권한, 저장소 루트에서 실행.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rawDir, root, run, writeJson } from './lib.mjs';

const name = process.argv[2];
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? process.argv[outArg + 1] : join(rawDir, `smoke-${name}.json`);
const PROMPT = 'README.md 파일의 첫 줄을 읽고 한 문장으로 요약해 줘. 파일은 고치지 마.';
const bins = { claude: 'claude', codex: 'codex', agy: 'agy' };
const load = (pkg) => import(pathToFileURL(join(root, 'packages', 'engines', pkg, 'dist', 'index.js')).href);

async function engineFor(n) {
  if (n === 'claude') return (await load('claude-code')).createClaudeCodeEngine();
  if (n === 'codex') return (await load('codex')).createCodexEngine();
  if (n === 'agy') return (await load('antigravity')).createAntigravityEngine();
  if (n === 'local') {
    const base = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
    const tags = await fetch(`${base}/api/tags`)
      .then((r) => r.json())
      .catch(() => null);
    const model = tags?.models?.[0]?.name;
    if (!model) return null;
    return (await load('openai-compat')).createApiEngine({
      id: 'local',
      baseUrl: `${base}/v1`,
      model,
      apiKey: 'ollama',
    });
  }
  throw new Error(`엔진 이름: claude | codex | agy | local`);
}

const rec = { engine: name, prompt: PROMPT, at: new Date().toISOString() };
if (bins[name]) {
  const v = run(bins[name], ['--version'], { timeout: 30_000 });
  rec.installed = v.status === 0;
  rec.version = (v.stdout || v.stderr || '').trim().split('\n')[0];
}
let engine = null;
if (rec.installed !== false)
  engine = await engineFor(name).catch((e) => ((rec.loadError = String(e?.message ?? e)), null));
if (!engine) {
  Object.assign(rec, { installed: false, result: '없음', success: false });
  writeJson(out, rec);
  console.log(JSON.stringify(rec));
  process.exit(0);
}
const t0 = Date.now();
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), 240_000);
const types = [];
let text = '';
let error = null;
try {
  const r = engine.run({
    sessionId: `audit-smoke-${name}`,
    cwd: root,
    permission: 'read-only',
    prompt: PROMPT,
    signal: ac.signal,
  });
  for await (const e of r.events) {
    types.push(e.type);
    if (e.type === 'assistant_text') text += e.text ?? '';
    if (e.type === 'error') error = { code: e.code, message: String(e.message ?? '').slice(0, 200) };
  }
  await r.done?.catch?.((e) => (error = { message: String(e?.message ?? e).slice(0, 200) }));
} catch (e) {
  error = { message: String(e?.message ?? e).slice(0, 200) };
}
clearTimeout(timer);
const kinds = [...new Set(types)];
Object.assign(rec, {
  installed: true,
  success: !error && types.includes('turn_end') && text.trim().length > 0,
  ms: Date.now() - t0,
  eventKinds: kinds,
  eventCount: types.length,
  textHead: text.trim().slice(0, 200),
  error,
  aborted: ac.signal.aborted,
});
writeJson(out, rec);
console.log(JSON.stringify({ engine: name, success: rec.success, ms: rec.ms, kinds, error }));
process.exit(0);
