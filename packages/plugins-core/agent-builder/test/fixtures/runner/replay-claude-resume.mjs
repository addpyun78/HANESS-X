// T-101 2B.9 리플레이용 가짜 claude (유료 호출 없음).
// 받은 인자를 HX_ARGV_FILE에 한 줄(JSON)로 덧붙이고, stream-json init(session_id)을 낸다.
// --resume <id>가 있으면 그 id를 이어 쓴다. 첫 호출이고 HX_HANG=1이면 끝없이 기다리고(멈추기 대상),
// 그 밖에는 결과(result)로 끝낸다.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const file = process.env.HX_ARGV_FILE;
const first = !existsSync(file) || readFileSync(file, 'utf8').trim() === '';
appendFileSync(file, JSON.stringify(argv) + '\n');
const i = argv.indexOf('--resume');
const sid = i >= 0 ? argv[i + 1] : 'replay-sess-1';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'system', subtype: 'init', session_id: sid, tools: [], mcp_servers: [] });
if (first && process.env.HX_HANG === '1') {
  setInterval(() => {}, 1000);
} else {
  out({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: '이어서 끝냈어요.' }] },
    session_id: sid,
  });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: sid });
}
