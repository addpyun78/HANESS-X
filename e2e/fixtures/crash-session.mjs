// T-064 64.4 크래시 픽스처: 하네스 세션 하나를 가짜 엔진(커널 도구 루프 + 대본 모델)으로 실행하다가
// 항목 2 도중(파일 하나를 쓴 뒤, 다음 모델 응답을 기다리는 중) "ready"를 출력하고 멈춘다. 부모가 SIGKILL로 죽인다.
//   node crash-session.mjs <kernel dist index.js> <checklist-ledger dist index.js> <log root> <workspace> <sessionId>
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [kernelEntry, ledgerEntry, root, ws, sessionId] = process.argv.slice(2);
const { EventLog, runAgentLoop } = await import(pathToFileURL(kernelEntry).href);
const { ChecklistLedger } = await import(pathToFileURL(ledgerEntry).href);

const ENGINE = 'fake-api';
const log = new EventLog({ root, fsync: true });
const ledger = new ChecklistLedger({
  dir: join(ws, '.harness-x', 'sessions', sessionId),
  sessionId,
  log,
  engineId: ENGINE,
});
const item = (id) => ({
  id,
  title: `항목 ${id} 구현`,
  artifactId: `art.part-${id}`,
  acceptance: [{ type: 'file_exists', file: `part-${id}.txt` }],
});
ledger.create([item('1'), item('2'), item('3')]);

/** 대본 모델: 첫 호출은 part-<id>.txt 쓰기, 그다음은 "완료" — hangAfterWrite면 두 번째 호출에서 영원히 대기 */
const model = (id, hangAfterWrite) => ({
  async complete(req) {
    if (req.messages.at(-1)?.role !== 'tool')
      return {
        text: `항목 ${id} 작성`,
        toolCalls: [
          { id: `c-${id}`, name: 'write_file', arguments: { path: `part-${id}.txt`, content: `${id}\n` } },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    if (hangAfterWrite) {
      log.flush();
      process.stdout.write('ready\n');
      return new Promise(() => {});
    }
    return { text: `항목 ${id} 완료`, toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } };
  },
});

async function runItem(id, hang) {
  ledger.transition(id, 'doing');
  for await (const e of runAgentLoop({
    client: model(id, hang),
    sessionId,
    cwd: ws,
    prompt: `항목 ${id}`,
    engineId: ENGINE,
    itemId: id,
  }))
    log.append(e);
  log.flush();
  ledger.transition(id, 'verifying');
  ledger.transition(id, 'done');
}

await runItem('1', false);
await runItem('2', true); // 여기서 멈춘 채 SIGKILL
