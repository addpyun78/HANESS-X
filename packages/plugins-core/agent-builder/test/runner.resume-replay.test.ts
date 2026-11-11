import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EngineAdapter, EngineRunOptions, HarnessEvent } from '@harness-x/protocol';
import { createClaudeCodeEngine } from '@harness-x/engine-claude-code';
import {
  Dispatcher,
  EventLog,
  resumeSession,
  toEngineRun,
  type DispatchAgent,
  type LogRecord,
} from '@harness-x/kernel';
import { PipelineRunner } from '../src/index.js';
import { pipeline, RUNNER_FX, tmpWorkspace } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

/** 다른 엔진(코덱스 자리): 받은 지시·resumeId를 기록하고 바로 끝낸다 */
function recordingEngine(id: string) {
  const calls: EngineRunOptions[] = [];
  const engine: EngineAdapter = {
    id,
    displayName: id,
    capabilities: { nativeStopHook: false, resume: true, mcp: false, interrupt: true },
    run(o) {
      calls.push(o);
      return toEngineRun(async function* (): AsyncGenerator<HarnessEvent> {
        yield {
          id: 'e1',
          ts: new Date().toISOString(),
          sessionId: o.sessionId,
          engineId: id,
          type: 'turn_end',
          reason: 'completed',
        };
      });
    },
  };
  return { engine, calls };
}

function setup() {
  ws = tmpWorkspace();
  const log = new EventLog({ root: join(ws.dir, 'logs') });
  const argvFile = join(ws.dir, 'argv.jsonl');
  const claude = createClaudeCodeEngine({
    command: process.execPath,
    prefixArgs: [RUNNER_FX('replay-claude-resume.mjs')],
  });
  const codex = recordingEngine('codex');
  const engines: Record<string, EngineAdapter> = { 'claude-code': claude, codex: codex.engine };
  const agent: DispatchAgent = {
    name: 'qa',
    command: '/qa',
    displayName: 'QA',
    pipeline: pipeline({
      name: 'qa',
      nodes: [{ id: 'build', type: 'role', engine: 'claude-code' }],
      edges: [],
    }),
  };
  const d = new Dispatcher({
    log,
    resolve: (n) => (n.replace('/', '') === 'qa' ? agent : undefined),
    run: (i) =>
      new PipelineRunner({
        engines,
        workspace: ws.dir,
        sessionId: i.sessionId,
        log,
        onEvent: i.onEvent,
        signal: i.signal,
        env: { ...process.env, HX_ARGV_FILE: argvFile, HX_HANG: '1' },
        ...(i.resume?.resumeIds ? { resumeIds: i.resume.resumeIds } : {}),
      }).run(i.pipeline, i.prompt),
  });
  const argv = () =>
    readFileSync(argvFile, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as string[]);
  const deps = (now?: Date) => ({
    log,
    dispatcher: d,
    agentFor: () => agent,
    engineCanResume: (id: string) => engines[id]?.capabilities.resume ?? false,
    ...(now ? { now: () => now } : {}),
  });
  return { log, d, argv, codex, deps };
}

/** 엔진 세션 id 기록(engine_session)이 나올 때까지 기다렸다가 지금 멈추기 */
async function runThenStop(t: ReturnType<typeof setup>) {
  const seen: LogRecord[] = [];
  const off = t.log.subscribe((r) => seen.push(r));
  const s = t.d.dispatch({ agent: 'qa', prompt: '헤더 고쳐 줘' });
  // 가짜 claude가 init을 낼 때까지 (실행 중) 기다린다
  for (let k = 0; k < 300; k++) {
    try {
      if (t.argv().length) break;
    } catch {
      /* 아직 파일 없음 */
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 200));
  await t.d.stopNow(s.sessionId);
  off();
  t.log.flush();
  return { sessionId: s.sessionId, seen };
}

describe.skipIf(process.platform === 'win32')(
  '2B.9 재개 방식 — 두 경로 리플레이 (실제 유료 호출 없음)',
  () => {
    it('같은 엔진 + 자체 재개 가능 + 7일 이내 → 엔진 재개 (claude --resume <엔진 세션 id>)', async () => {
      const t = setup();
      const { sessionId, seen } = await runThenStop(t);
      expect(seen.find((e) => e.type === 'engine_session')).toMatchObject({
        nodeId: 'build',
        engineSessionId: 'replay-sess-1',
      });
      const r = await resumeSession(t.deps(), sessionId);
      expect(r.mode).toBe('engine');
      const end = await t.d.wait(sessionId);
      expect(end.status).toBe('completed');
      const calls = t.argv();
      expect(calls).toHaveLength(2);
      expect(calls[0]).not.toContain('--resume');
      const second = calls[1]!;
      expect(second[second.indexOf('--resume') + 1]).toBe('replay-sess-1');
      expect(second.at(-1)).toContain('멈췄던 곳에서 이어서 계속하세요.');
      expect(t.codex.calls).toHaveLength(0);
    });

    it('다른 엔진으로 바꾸면 → 요약 컨텍스트로 새 세션 (엔진 중립, resumeId 없음)', async () => {
      const t = setup();
      const { sessionId } = await runThenStop(t);
      const r = await resumeSession(t.deps(), sessionId, { engine: 'codex' });
      expect(r.mode).toBe('summary');
      expect((await t.d.wait(sessionId)).status).toBe('completed');
      expect(t.argv()).toHaveLength(1); // claude는 다시 안 불림
      expect(t.codex.calls).toHaveLength(1);
      const call = t.codex.calls[0]!;
      expect(call.resumeId).toBeUndefined();
      expect(call.prompt).toContain('이전에 멈춘 작업을 이어서 합니다');
      expect(call.prompt).toContain('원래 지시: 헤더 고쳐 줘');
    });

    it('같은 엔진이어도 7일이 지났으면 → 요약 컨텍스트', async () => {
      const t = setup();
      const { sessionId } = await runThenStop(t);
      const later = new Date(Date.now() + 8 * 86_400_000);
      const r = await resumeSession(t.deps(later), sessionId);
      expect(r.mode).toBe('summary');
      expect((await t.d.wait(sessionId)).status).toBe('completed');
      const calls = t.argv();
      expect(calls).toHaveLength(2);
      expect(calls[1]).not.toContain('--resume');
      expect(calls[1]!.at(-1)).toContain('이전에 멈춘 작업을 이어서 합니다');
    });
  },
);
