import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EngineAdapter, EngineRunOptions, HarnessEvent } from '@harness-x/protocol';
import { ChecklistLedger } from '@harness-x/checklist-ledger';
import {
  Dispatcher,
  EventLog,
  createResumeService,
  eventFactory,
  pinRunVersion,
  readSessionEvents,
  registerResumeRoutes,
  takePauseSnapshot,
  type DispatchAgent,
} from '@harness-x/kernel';
import { bootApi } from '../../../kernel/test/api-fixtures.js';
import { PipelineRunner } from '../src/index.js';
import { completeItems, items, pipeline, tmpWorkspace } from './runner-helpers.js';

let ws: ReturnType<typeof tmpWorkspace>;
afterEach(() => ws?.cleanup());

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** 손으로 조종하는 엔진: 턴마다 script가 이벤트를 내고, gate를 기다릴 수 있다 */
function scriptedEngine(
  id: string,
  script: (o: EngineRunOptions, k: number, emit: (b: Record<string, unknown>) => void) => Promise<void>,
) {
  const calls: EngineRunOptions[] = [];
  const engine: EngineAdapter = {
    id,
    displayName: id,
    capabilities: { nativeStopHook: false, resume: false, mcp: false, interrupt: true },
    run(o) {
      const k = calls.length;
      calls.push(o);
      const ev = eventFactory({ sessionId: o.sessionId, engineId: id });
      const q: HarnessEvent[] = [];
      let wake: (() => void) | undefined;
      let finished = false;
      const emit = (b: Record<string, unknown>) => {
        q.push(ev(b as never));
        wake?.();
      };
      const done = (async () => {
        try {
          await script(o, k, emit);
          emit({ type: 'turn_end', reason: o.signal?.aborted ? 'interrupted' : 'completed' });
        } finally {
          finished = true;
          wake?.();
        }
        return { exitCode: 0 };
      })();
      async function* events() {
        for (;;) {
          const e = q.shift();
          if (e) {
            yield e;
            if (e.type === 'turn_end') return;
            continue;
          }
          if (finished) return;
          await new Promise<void>((r) => (wake = r));
          wake = undefined;
        }
      }
      return { events: events(), engineSessionId: () => undefined, interrupt: async () => {}, done };
    },
  };
  return { engine, calls };
}

const untilAbort = (o: EngineRunOptions) =>
  new Promise<void>((r) => {
    if (o.signal?.aborted) return r();
    o.signal?.addEventListener('abort', () => r(), { once: true });
  });

let debugInfo = () => '';
async function until(fn: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`시간 초과 ${debugInfo()}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** 서버(정지·이어하기 API) + Dispatcher + 실제 PipelineRunner */
async function boot(engines: Record<string, EngineAdapter>, agent: DispatchAgent, available: string[]) {
  const log = new EventLog({ root: join(ws.dir, '..', `${ws.dir.split('/').pop()}-logs`) });
  const runner = (i: Parameters<ConstructorParameters<typeof Dispatcher>[0]['run']>[0]) =>
    new PipelineRunner({
      engines,
      workspace: ws.dir,
      sessionId: i.sessionId,
      log,
      onEvent: i.onEvent,
      signal: i.signal,
      checklists: (node) => (node.id === 'build' ? items('i', 2) : undefined),
    }).run(i.pipeline, i.prompt);
  const d = new Dispatcher({
    log,
    resolve: (n) => (n.replace('/', '') === agent.name ? agent : undefined),
    engines: () => Object.keys(engines),
    run: runner,
    onPaused: (s, c) => {
      const snap = takePauseSnapshot({
        sessionId: s.sessionId,
        paused: s.paused!,
        cwd: ws.dir,
        sessionDir: dirname(log.sessionFile(s.sessionId)),
        ...(c.itemId ? { itemId: c.itemId } : {}),
      });
      return { snapshot: { kind: snap.files.kind } };
    },
    onCreated: (s, c) =>
      pinRunVersion({
        sessionId: s.sessionId,
        sessionDir: dirname(log.sessionFile(s.sessionId)),
        agent: c.agent.name,
        pipeline: c.pipeline,
      }),
  });
  // 실제 API 서버: 정지 API(startApiServer dispatch → sessions-routes) + 이어하기 API
  const api = await bootApi({
    dispatch: d,
    routes: (app) =>
      registerResumeRoutes(app, {
        log,
        service: createResumeService({
          log,
          dispatcher: d,
          agentFor: (n) => (n === agent.name ? agent : undefined),
          engines: () => available,
          engineCanResume: () => false,
          ledger: (id) =>
            new ChecklistLedger({
              dir: join(ws.dir, '.harness-x', 'sessions', id, 'nodes', 'build.1'),
              sessionId: id,
            }),
        }),
      }),
  });
  debugInfo = () => JSON.stringify(d.sessions());
  const post = async (path: string, body: unknown = {}) => {
    const r = await api.post(path, body, api.auth);
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const server = { close: () => api.close() };
  return { log, d, server, post };
}

describe('2C 회귀 E2E (정지 → 이어하기)', () => {
  it('2C.1 실행 → 일시정지 → 파일 수동 수정 → 이어하기 → 변경 카드 → 반영해서 계속 → 완료', async () => {
    ws = tmpWorkspace();
    git(ws.dir, 'init', '-q');
    git(ws.dir, 'config', 'user.email', 't@example.com');
    git(ws.dir, 'config', 'user.name', 't');
    writeFileSync(join(ws.dir, 'header.tsx'), 'export const H = 1;\n');
    git(ws.dir, 'add', '.');
    git(ws.dir, 'commit', '-qm', 'init');
    let releaseTool!: () => void;
    const toolGate = new Promise<void>((r) => (releaseTool = r));
    const eng = scriptedEngine('claude-code', async (o, k, emit) => {
      if (k === 0) {
        // 첫 턴: i1을 하면서 파일을 쓴다 → 도구가 끝나는 순간(안전한 지점) 일시정지
        emit({ type: 'tool_call', callId: 'c1', tool: 'write_file', input: { path: 'header.tsx' } });
        await toolGate;
        writeFileSync(join(o.cwd, 'header.tsx'), 'export const H = 2;\n');
        completeItems(o, ['i1']);
        emit({ type: 'file_change', path: 'header.tsx', change: 'modify' });
        emit({ type: 'tool_result', callId: 'c1', ok: true, output: 'ok' });
        await untilAbort(o);
        return;
      }
      // 이어서: 남은 항목을 끝낸다
      completeItems(o);
    });
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
    const t = await boot({ 'claude-code': eng.engine }, agent, ['claude-code']);
    try {
      const s = t.d.dispatch({ agent: 'qa', prompt: '헤더 고쳐 줘' });
      await until(() => eng.calls.length === 1);
      // ⏸ 일시정지 (API)
      const p = await t.post(`/api/sessions/${s.sessionId}/pause`);
      expect(p).toMatchObject({ status: 202, body: { state: 'pausing' } });
      releaseTool();
      await until(() => t.d.get(s.sessionId)!.status === 'paused');
      t.log.flush();
      expect(t.d.get(s.sessionId)!.paused).toMatchObject({ reason: 'user' });
      // 사용자가 파일을 직접 고침
      writeFileSync(join(ws.dir, 'header.tsx'), 'export const H = 3; // 사람이 고침\n');
      // 이어하기 → 점검: 변경 카드
      const c = await t.post(`/api/resume/${s.sessionId}/check`);
      expect(c.status).toBe(200);
      const issues = c.body.issues as {
        check: string;
        list?: string[];
        choices: { id: string; label: string }[];
      }[];
      expect(issues.map((i) => i.check)).toEqual(['files']);
      expect(issues[0]!.list).toEqual(['header.tsx (고쳐짐)']);
      expect(issues[0]!.choices[0]).toMatchObject({ id: 'keep', label: '바뀐 걸 반영해서 계속' });
      // [바뀐 걸 반영해서 계속]
      const r = await t.post(`/api/resume/${s.sessionId}`, { files: 'keep' });
      expect(r.status).toBe(202);
      const end = await t.d.wait(s.sessionId);
      expect(end.status).toBe('completed');
      // 사람이 고친 내용은 그대로, 이어간 지시에 바뀐 파일을 알림
      expect(readFileSync(join(ws.dir, 'header.tsx'), 'utf8')).toBe('export const H = 3; // 사람이 고침\n');
      expect(eng.calls[1]!.prompt).toContain('멈춘 뒤 사용자가 바꾼 파일: header.tsx (고쳐짐)');
      const types = readSessionEvents(t.log, s.sessionId)
        .map((e) => e.type)
        .filter((x) => x.startsWith('session_') || x === 'pause_requested');
      expect(types).toEqual([
        'session_created',
        'pause_requested',
        'session_paused',
        'session_resumed',
        'session_end',
      ]);
    } finally {
      await t.server.close();
    }
  });

  it('2C.2 지금 멈추기 → 다른 엔진으로 이어하기 → 체크리스트 유지', async () => {
    ws = tmpWorkspace();
    const claude = scriptedEngine('claude-code', async (o) => {
      completeItems(o, ['i1']); // i1까지 하고
      await untilAbort(o); // 멈출 때까지 일하는 중
    });
    const codex = scriptedEngine('codex', async (o) => completeItems(o));
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
    // 이어할 때 claude-code는 쓸 수 없다 (사용량 한도 등)
    const t = await boot({ 'claude-code': claude.engine, codex: codex.engine }, agent, ['codex']);
    try {
      const s = t.d.dispatch({ agent: 'qa', prompt: '회원 기능' });
      await until(() => claude.calls.length === 1);
      const ledgerDir = join(ws.dir, '.harness-x', 'sessions', s.sessionId, 'nodes', 'build.1');
      await until(
        () =>
          new ChecklistLedger({ dir: ledgerDir, sessionId: s.sessionId }).read()?.items[0]?.status === 'done',
      );
      // ⏹ 지금 멈추기
      const stop = await t.post(`/api/sessions/${s.sessionId}/stop`);
      expect(stop).toMatchObject({ status: 200, body: { state: 'paused' } });
      t.log.flush();
      // 점검: 그때 쓰던 AI를 못 씀 → 코덱스 제안
      const c = await t.post(`/api/resume/${s.sessionId}/check`);
      const issues = c.body.issues as { check: string; choices: { id: string }[] }[];
      expect(issues.map((i) => i.check)).toEqual(['engine']);
      expect(issues[0]!.choices[0]!.id).toBe('engine:codex');
      // 다른 엔진으로 이어하기
      const r = await t.post(`/api/resume/${s.sessionId}`, { engine: 'codex' });
      expect(r).toMatchObject({ status: 202, body: { mode: 'summary' } });
      expect((await t.d.wait(s.sessionId)).status).toBe('completed');
      // 체크리스트 유지: i1은 처음 엔진이 끝낸 그대로, i2는 코덱스가 끝냄 (다시 만들지 않음)
      const final = new ChecklistLedger({ dir: ledgerDir, sessionId: s.sessionId }).read()!;
      expect(final.items.map((i) => [i.id, i.status])).toEqual([
        ['i1', 'done'],
        ['i2', 'done'],
      ]);
      expect(final.items[0]!.attempts).toBe(1);
      expect(codex.calls[0]!.prompt).toContain('- [x] i1');
      expect(codex.calls[0]!.prompt).toContain('- [ ] i2');
    } finally {
      await t.server.close();
    }
  });
});
