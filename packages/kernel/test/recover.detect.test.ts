import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EventLog } from '../src/event-log.js';
import { findUnfinishedSessions, readSessionEvents } from '../src/recover.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const KERNEL_DIST = resolve(here, '../dist/index.js');
const WRITER = join(here, 'fixtures/crash-writer.mjs');

/** 자식 프로세스가 턴 도중 기록하다 SIGKILL로 죽는다 */
function crash(root: string, sessionId: string): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [WRITER, KERNEL_DIST, root, sessionId], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (b: Buffer) => {
      if (b.toString().includes('ready')) child.kill('SIGKILL');
    });
    child.on('exit', (_code, signal) => (signal === 'SIGKILL' ? ok() : fail(new Error(`exit ${signal}`))));
    child.on('error', fail);
  });
}

describe('61.1 시작 시 미종료 세션 탐지 (강제 종료 픽스처)', () => {
  it(
    'SIGKILL된 세션만 미종료로 잡고, 잘린 줄을 닫아 이후 기록이 섞이지 않는다',
    { timeout: 240_000 },
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'hx-recover-'));
      try {
        await crash(root, 'crashed');
        // 정상 종료한 세션들 (다른 "이전 실행")
        const before = new EventLog({ root });
        const base = { ts: new Date().toISOString(), engineId: 'codex' };
        before.append({ id: 'd1', sessionId: 'finished', type: 'assistant_text', text: 'hi', ...base });
        before.append({ id: 'd2', sessionId: 'finished', type: 'turn_end', reason: 'completed', ...base });
        // turn_end 뒤의 커널 기록(hook_result)·원장 기록은 미종료로 보지 않는다
        before.append({
          id: 'd3',
          sessionId: 'finished',
          type: 'hook_result',
          hookId: 'h',
          hook: 'stop.before',
          mode: 'blocking',
          decision: 'allow',
          durationMs: 1,
          ...base,
        });
        before.append({
          id: 'd4',
          sessionId: 'plan-only',
          type: 'checklist_change',
          changedItemId: '1',
          from: null,
          to: 'todo',
          version: 1,
          ...base,
        });
        before.close();

        // 하네스 재시작
        const log = new EventLog({ root });
        const found = findUnfinishedSessions(log);
        expect(found.map((f) => f.sessionId)).toEqual(['crashed']);
        expect(found[0]!.lastEvent).toMatchObject({ type: 'tool_call', callId: 'c2', tool: 'Bash' });
        // 인덱스에 늦게 반영됐어도 JSONL 원본 기준으로 읽는다 (잘린 줄 제외 5개)
        expect(readSessionEvents(log, 'crashed')).toHaveLength(5);
        // 잘린 줄이 닫혀서 재개 후 기록이 온전한 줄로 남는다
        log.append({
          id: 'r1',
          sessionId: 'crashed',
          ts: new Date().toISOString(),
          type: 'turn_end',
          reason: 'interrupted',
        });
        log.flush();
        const lines = readFileSync(log.sessionFile('crashed'), 'utf8').trim().split('\n');
        expect(JSON.parse(lines.at(-1)!)).toMatchObject({ id: 'r1' });
        expect(findUnfinishedSessions(log)).toEqual([]);
        log.close();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
