// 강제 종료 픽스처 (T-061 61.1): 커널 EventLog로 턴 도중까지 기록하고, 찢어진 쓰기(잘린 줄)를 남긴 뒤
// "ready"를 출력하고 대기한다. 부모가 SIGKILL로 죽인다.
//   node crash-writer.mjs <kernel dist index.js> <log root> <sessionId>
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [kernelEntry, root, sessionId] = process.argv.slice(2);
const { EventLog } = await import(pathToFileURL(kernelEntry).href);
const log = new EventLog({ root, fsync: true });
let n = 0;
const ev = (body) => ({
  id: `${sessionId}-${++n}`,
  ts: new Date(Date.UTC(2026, 10, 11, 0, 0, n)).toISOString(),
  sessionId,
  engineId: 'claude-code',
  itemId: '1',
  ...body,
});
log.append(ev({ type: 'assistant_text', text: '항목 1을 시작합니다' }));
log.append(ev({ type: 'tool_call', callId: 'c1', tool: 'Write', input: { path: 'a.txt' } }));
log.append(ev({ type: 'tool_result', callId: 'c1', ok: true, output: 'ok' }));
log.append(ev({ type: 'file_change', path: 'a.txt', change: 'create' }));
log.append(ev({ type: 'tool_call', callId: 'c2', tool: 'Bash', input: { command: 'pnpm test' } }));
log.flush();
// 찢어진 쓰기: 줄 절반만 디스크에 남은 상태
appendFileSync(log.sessionFile(sessionId), '{"id":"torn","ts":"2026-11-11T00:00:09.000Z","sessionId":"');
process.stdout.write('ready\n');
setInterval(() => {}, 1000);
