// 실제 Ollama로 도구 루프 확인 (T-017 17.2): 모델이 read_file을 호출해 파일 내용을 읽고 답해야 한다
// 실행: pnpm -r build && node scripts/smoke/ollama-tool-loop.mjs [모델]   (기본 모델: OLLAMA_MODEL 또는 qwen3)
// 전제: Ollama가 http://127.0.0.1:11434 에서 실행 중이고 도구 호출을 지원하는 모델이 받아져 있다
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ollamaEngine } from '../../packages/engines/openai-compat/dist/index.js';

const host = process.env.OLLAMA_HOST_URL ?? 'http://127.0.0.1:11434';
let tags;
try {
  const r = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) });
  tags = await r.json();
} catch (err) {
  console.error(`Ollama에 연결할 수 없습니다 (${host}): ${err.message}`);
  process.exit(2);
}
const names = (tags.models ?? []).map((m) => m.name);
const wanted = process.argv[2] ?? process.env.OLLAMA_MODEL ?? 'qwen3';
const model = names.find((n) => n === wanted || n.startsWith(`${wanted}:`)) ?? wanted;
console.log(`models: ${names.join(', ') || '(없음)'} → 사용: ${model}`);

const dir = mkdtempSync(join(tmpdir(), 'hx-ollama-'));
const word = `kiwi-${Math.random().toString(36).slice(2, 7)}`;
writeFileSync(join(dir, 'secret.txt'), `The secret word is ${word}.\n`);
try {
  const engine = ollamaEngine({ baseUrl: `${host}/v1`, defaultModel: model });
  const run = engine.run({
    sessionId: 'smoke',
    cwd: dir,
    prompt: 'Read the file secret.txt with the read_file tool and tell me the secret word.',
  });
  let calls = 0;
  let readOk = false;
  let final = '';
  for await (const e of run.events) {
    if (e.type === 'tool_call') {
      calls++;
      console.log(`tool_call ${e.tool} ${JSON.stringify(e.input)}`);
    } else if (e.type === 'tool_result') {
      console.log(`tool_result ok=${e.ok}`);
      if (e.ok && String(e.output).includes(word)) readOk = true;
    } else if (e.type === 'assistant_text' && !e.partial) final = e.text;
    else if (e.type === 'error') console.log(`error ${e.code}: ${e.message}`);
    else if (e.type === 'turn_end') console.log(`turn_end ${e.reason}`);
  }
  console.log(`final: ${final.trim()}`);
  const pass = calls >= 1 && readOk && final.includes(word);
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
