import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePipeline } from '@harness-x/protocol';
import { registerSessionRoutes } from '../src/api/sessions-routes.js';
import { EventLog, type LogRecord } from '../src/event-log.js';
import { Dispatcher, type DispatchAgent, type DispatchRunInput } from '../src/dispatch.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

const agent = (name: string, ids: string[]): DispatchAgent => ({
  name,
  command: `/${name}`,
  displayName: name.toUpperCase(),
  icon: '🎨',
  pipeline: parsePipeline({
    name,
    nodes: ids.map((id) => ({ id, type: 'role' })),
    edges: ids.slice(1).map((id, i) => ({ from: ids[i]!, to: id })),
  }),
});

const AGENTS = [agent('design-qa', ['plan', 'build', 'critic']), agent('review', ['look'])];
const resolve = (n: string) => AGENTS.find((a) => a.name === n || a.command === n);

/** 노드마다 node_start/node_end를 내는 가짜 실행 (gate가 열릴 때까지 첫 노드에서 멈춤) */
function fakeRun(calls: DispatchRunInput[], gate?: Promise<void>) {
  return async (i: DispatchRunInput) => {
    calls.push(i);
    for (const [k, n] of i.pipeline.nodes.entries()) {
      i.onEvent({ id: `s${k}`, ts: '', sessionId: i.sessionId, type: 'node_start', nodeId: n.id });
      if (k === 0 && gate) await gate;
      i.onEvent({
        id: `e${k}`,
        ts: '',
        sessionId: i.sessionId,
        type: 'node_end',
        nodeId: n.id,
        status: 'completed',
      });
    }
    return { status: 'completed', result: { ok: i.agent.name } };
  };
}

const tmp = tempDir('hx-dispatch-');
const log = new EventLog({ root: join(tmp.dir, 'logs') });
afterEach(() => log.flush());

describe('48.1 칩 + 지시문 → 새 세션 (session_created)', () => {
  it('에이전트 파이프라인으로 실행, 수식어 적용, 진행률·현재 노드, session_created → session_end', async () => {
    const calls: DispatchRunInput[] = [];
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const seen: LogRecord[] = [];
    const off = log.subscribe((r) => seen.push(r));
    const d = new Dispatcher({
      resolve,
      run: fakeRun(calls, gate),
      log,
      engines: () => ['codex', 'claude-code'],
    });
    const s = d.dispatch({ agent: '/design-qa', prompt: '헤더 고쳐 줘 @codex #strict' });
    expect(s).toMatchObject({
      status: 'running',
      agent: { name: 'design-qa', command: '/design-qa', icon: '🎨' },
      prompt: '헤더 고쳐 줘',
      modifiers: { engine: 'codex', strict: true, planOnly: false },
      nodeCount: 3,
      progress: 0,
    });
    await Promise.resolve();
    expect(d.get(s.sessionId)).toMatchObject({ currentNode: 'plan', progress: 0 });
    expect(calls[0]!.pipeline.nodes.every((n) => 'engine' in n && n.engine === 'codex')).toBe(true);
    expect(calls[0]!.prompt).toBe('헤더 고쳐 줘');

    // 48.4 실행 중 서브에이전트 추가 → 본 파이프라인 뒤 같은 세션에서 실행
    const withSub = d.addSubagent(s.sessionId, 'review');
    expect(withSub.subagents).toEqual(['/review']);
    expect(withSub.nodeCount).toBe(4);
    open();
    const end = await d.wait(s.sessionId);
    off();
    expect(end).toMatchObject({ status: 'completed', progress: 1, currentNode: undefined });
    expect(end.completedNodes).toEqual(['plan', 'build', 'critic', 'review/look']);
    expect(calls.map((c) => c.agent.name)).toEqual(['design-qa', 'review']);
    expect(calls[1]!.prompt).toContain('앞 단계 결과');
    expect(calls[1]!.sessionId).toBe(s.sessionId);

    const mine = seen.filter((r) => r.sessionId === s.sessionId).map((r) => r.type);
    expect(mine).toEqual(['session_created', 'subagent_added', 'session_end']);
    const created = seen.find((r) => r.type === 'session_created')!;
    expect(created).toMatchObject({
      agent: 'design-qa',
      command: '/design-qa',
      icon: '🎨',
      nodes: ['plan', 'build', 'critic'],
      nodeCount: 3,
    });
    expect(() => d.addSubagent(s.sessionId, 'review')).toThrow(/실행 중이 아닌/);
  });

  it('!plan: 첫 노드만, 없는 에이전트·감지 안 된 엔진은 거부, 실행 오류는 status error', async () => {
    const calls: DispatchRunInput[] = [];
    const d = new Dispatcher({ resolve, run: fakeRun(calls), engines: () => ['codex'] });
    const s = d.dispatch({ agent: 'design-qa', prompt: '!plan 설계만' });
    expect(s.nodeCount).toBe(1);
    expect((await d.wait(s.sessionId)).status).toBe('completed');
    expect(calls[0]!.pipeline.nodes.map((n) => n.id)).toEqual(['plan']);
    expect(() => d.dispatch({ agent: '/nope', prompt: 'x' })).toThrow(
      expect.objectContaining({ code: 'unknown_agent' }),
    );
    expect(() => d.dispatch({ agent: 'design-qa', prompt: '@gemini x' })).toThrow(
      expect.objectContaining({ code: 'unknown_engine' }),
    );
    const bad = new Dispatcher({
      resolve,
      run: async () => {
        throw new Error('엔진 없음');
      },
    });
    const e = bad.dispatch({ agent: 'review', prompt: 'x' });
    expect(await bad.wait(e.sessionId)).toMatchObject({ status: 'error', reason: '엔진 없음' });
  });

  it('POST /api/sessions → 201 세션, GET 목록, 404·400, 서브에이전트 라우트', async () => {
    const calls: DispatchRunInput[] = [];
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const dispatcher = new Dispatcher({ resolve, run: fakeRun(calls, gate), engines: () => ['codex'] });
    const api = await bootApi({ routes: (app) => registerSessionRoutes(app, dispatcher) });
    try {
      const post = (p: string, b: unknown) => api.post(p, b, api.auth);
      const res = await post('/api/sessions', {
        agent: '/design-qa',
        prompt: '시작',
        modifiers: { strict: true },
      });
      expect(res.status).toBe(201);
      const s = (await res.json()) as { sessionId: string; modifiers: { strict: boolean } };
      expect(s.modifiers.strict).toBe(true);
      const list = (await (await api.get('/api/sessions', api.auth)).json()) as { sessions: unknown[] };
      expect(list.sessions).toHaveLength(1);
      expect((await post(`/api/sessions/${s.sessionId}/subagents`, { agent: 'review' })).status).toBe(200);
      expect((await post(`/api/sessions/${s.sessionId}/subagents`, { agent: 'nope' })).status).toBe(404);
      expect((await post('/api/sessions/zzz/subagents', { agent: 'review' })).status).toBe(404);
      expect((await post('/api/sessions', { agent: 'nope', prompt: 'x' })).status).toBe(404);
      expect((await post('/api/sessions', { prompt: 'x' })).status).toBe(400);
      expect((await post('/api/sessions', { agent: 'review', prompt: '@gemini x' })).status).toBe(400);
      open();
      await dispatcher.wait(s.sessionId);
      const one = (await (await api.get(`/api/sessions/${s.sessionId}`, api.auth)).json()) as {
        status: string;
        progress: number;
      };
      expect(one).toMatchObject({ status: 'completed', progress: 1 });
      expect((await api.get('/api/sessions/zzz', api.auth)).status).toBe(404);
    } finally {
      await api.close();
    }
  });
});
