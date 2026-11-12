// 테스트용 가짜 codex. `exec` 인자면 HX_FAKE_EXEC_REPLAY(NDJSON)를 그대로 출력하고 종료하고(HX_FAKE_LOG에 argv 기록),
// `app-server` 인자면 stdio JSON-RPC(줄 단위). 실제 서버처럼 initialize → initialized 전에는
// 다른 요청을 거부한다. 환경변수:
//   HX_FAKE_LOG       받은 메시지를 줄마다 기록할 파일
//   HX_FAKE_REPLAY    turn/start 응답 뒤 그대로 내보낼 서버 알림 JSONL (녹화 파일)
//   HX_FAKE_RATELIMITS account/rateLimits/read 응답 JSON 파일 ({result} 또는 {error})
//   HX_FAKE_HANG=1    turn/start 뒤 turn/started만 내고 대기 (turn/interrupt 오면 interrupted로 완료)
//   HX_FAKE_NO_INIT=1 initialize에 응답하지 않음 (폴백 테스트)
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const env = process.env;
if (process.argv.includes('exec')) {
  if (env.HX_FAKE_LOG)
    appendFileSync(env.HX_FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2) }) + '\n');
  process.stdout.write(readFileSync(env.HX_FAKE_EXEC_REPLAY, 'utf8'), () => process.exit(0));
} else {
  const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
  const log = (m) => env.HX_FAKE_LOG && appendFileSync(env.HX_FAKE_LOG, JSON.stringify(m) + '\n');
  let initialized = false;
  const THREAD = 'thr_fake_0001';
  const TURN = 'turn_fake_0001';

  createInterface({ input: process.stdin }).on('line', (line) => {
    const m = JSON.parse(line);
    log(m);
    if (m.method === 'initialized') {
      initialized = true;
      return;
    }
    if (m.id === undefined) return;
    if (m.method === 'initialize') {
      if (env.HX_FAKE_NO_INIT === '1') return;
      return send({
        id: m.id,
        result: {
          userAgent: 'fake/0.155.1',
          codexHome: '/tmp/codex-home',
          platformFamily: 'unix',
          platformOs: 'linux',
        },
      });
    }
    if (!initialized) return send({ id: m.id, error: { code: -32600, message: 'Not initialized' } });
    switch (m.method) {
      case 'account/rateLimits/read': {
        const r = env.HX_FAKE_RATELIMITS
          ? JSON.parse(readFileSync(env.HX_FAKE_RATELIMITS, 'utf8'))
          : { result: {} };
        return send({ id: m.id, ...r });
      }
      case 'model/list':
        return send({
          id: m.id,
          result: {
            data: [
              { id: 'gpt-5.5-codex', model: 'gpt-5.5-codex', displayName: 'GPT-5.5 Codex' },
              { id: 'gpt-5.5', model: 'gpt-5.5', displayName: 'GPT-5.5' },
              { id: 'old', model: 'old-model', hidden: true },
            ],
            nextCursor: null,
          },
        });
      case 'thread/start':
      case 'thread/resume': {
        const id = m.params?.threadId ?? THREAD;
        send({ id: m.id, result: { thread: { id }, model: 'gpt-5.5-codex', cwd: m.params?.cwd } });
        return send({ method: 'thread/started', params: { thread: { id } } });
      }
      case 'turn/start': {
        send({ id: m.id, result: { turn: { id: TURN, items: [], status: 'inProgress', error: null } } });
        if (env.HX_FAKE_HANG === '1') {
          send({
            method: 'turn/started',
            params: { threadId: THREAD, turn: { id: TURN, status: 'inProgress' } },
          });
          return;
        }
        const lines = readFileSync(env.HX_FAKE_REPLAY, 'utf8').split('\n').filter(Boolean);
        for (const l of lines) process.stdout.write(l + '\n');
        return;
      }
      case 'turn/interrupt':
        send({ id: m.id, result: {} });
        return send({
          method: 'turn/completed',
          params: { threadId: THREAD, turn: { id: TURN, items: [], status: 'interrupted', error: null } },
        });
      default:
        return send({ id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
    }
  });
}
