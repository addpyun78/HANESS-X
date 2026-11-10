// 테스트용 가짜 claude / codex (28.6). 실제 CLI처럼 프로젝트의 Stop 훅 설정을 읽어 턴 끝에 훅 명령을 실행한다.
//   node fake-stop-engine.mjs claude <claude 인자…>      → <cwd>/.claude/settings.local.json, stream-json 출력
//   node fake-stop-engine.mjs codex exec <codex 인자…>   → <cwd>/.codex/hooks.json, exec --json NDJSON 출력
// 훅이 {"decision":"block","reason"}을 내면 reason을 새 사용자 지시로 받아 한 번 더 "작업"하고
// stop_hook_active=true로 다시 훅을 부른다(최대 5회). 통과하면 턴을 끝낸다.
// HX_FAKE_HOOK_LOG: 훅 호출·결정 기록 파일
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const kind = process.argv[2];
const cwd = process.cwd();
const cfgFile =
  kind === 'claude' ? join(cwd, '.claude', 'settings.local.json') : join(cwd, '.codex', 'hooks.json');
const cfg = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, 'utf8')) : {};
const commands = (cfg.hooks?.Stop ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command));
const SESSION = kind === 'claude' ? '0b7c6a5e-1111-4222-8333-444455556666' : 'thr_fake_stop';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const texts = [];

function runStopHooks(active) {
  for (const command of commands) {
    const r = spawnSync('/bin/sh', ['-c', command], {
      cwd,
      input: JSON.stringify({ session_id: SESSION, hook_event_name: 'Stop', stop_hook_active: active }),
      encoding: 'utf8',
    });
    const res = r.stdout.trim() ? JSON.parse(r.stdout) : null;
    if (process.env.HX_FAKE_HOOK_LOG)
      appendFileSync(process.env.HX_FAKE_HOOK_LOG, JSON.stringify({ kind, active, res }) + '\n');
    if (res?.decision === 'block') return res.reason;
  }
  return null;
}

texts.push('작업 완료로 보입니다.');
let active = false;
for (let i = 0; i < 5; i++) {
  const reason = runStopHooks(active);
  if (!reason) break;
  texts.push(`(Stop 훅 차단) 계속합니다: ${reason}`);
  active = true;
}

if (kind === 'claude') {
  out({ type: 'system', subtype: 'init', session_id: SESSION, tools: ['Read'], mcp_servers: [] });
  for (const t of texts)
    out({
      type: 'assistant',
      session_id: SESSION,
      message: { role: 'assistant', content: [{ type: 'text', text: t }] },
    });
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: SESSION,
    result: texts.at(-1),
    usage: { input_tokens: 1, output_tokens: 1 },
  });
} else {
  out({ type: 'thread.started', thread_id: SESSION });
  out({ type: 'turn.started' });
  texts.forEach((t, k) =>
    out({ type: 'item.completed', item: { id: `item_${k}`, type: 'agent_message', text: t } }),
  );
  out({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } });
}
