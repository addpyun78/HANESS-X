import { join } from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { parsePipeline } from '@harness-x/protocol';
import { registerSessionRoutes } from '../src/api/sessions-routes.js';
import { EventLog, type LogRecord } from '../src/event-log.js';
import { Dispatcher, type DispatchAgent, type DispatchRunInput } from '../src/dispatch.js';
import {
  isPauseReason,
  isStopKind,
  PAUSE_REASONS,
  STOP_KINDS,
  type PausedInfo,
  type StopKind,
  type StopResult,
} from '../src/stop.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

const agent: DispatchAgent = {
  name: 'qa',
  command: '/qa',
  displayName: 'QA',
  pipeline: parsePipeline({ name: 'qa', nodes: [{ id: 'build', type: 'role' }], edges: [] }),
};

/** signal이 abort될 때까지 첫 노드에서 기다리는 가짜 실행 (abort면 실행기처럼 error로 끝남) */
const hangUntilAbort = async (i: DispatchRunInput) => {
  i.onEvent({ id: 'n', ts: '', sessionId: i.sessionId, type: 'node_start', nodeId: 'build' });
  await new Promise<void>((r) => i.signal.addEventListener('abort', () => r(), { once: true }));
  return { status: 'error', reason: '중단됨', haltedAt: 'build' };
};

const tmp = tempDir('hx-stop-');
const log = new EventLog({ root: join(tmp.dir, 'logs') });
afterEach(() => log.flush());

const mk = () =>
  new Dispatcher({
    resolve: (n) => (n.replace('/', '') === 'qa' ? agent : undefined),
    run: hangUntilAbort,
    log,
  });

describe('2A.2 정지 3종 — 타입', () => {
  it('정지 종류 3개, 멈춘 이유 5개, 판별 함수', () => {
    expect(STOP_KINDS).toEqual(['pause', 'stop-now', 'stop-all']);
    expect(PAUSE_REASONS).toEqual(['user', 'quota', 'crash', 'approval', 'budget']);
    expect(isStopKind('pause')).toBe(true);
    expect(isStopKind('kill')).toBe(false);
    expect(isPauseReason('quota')).toBe(true);
    expect(isPauseReason('x')).toBe(false);
    expectTypeOf<StopResult['kind']>().toEqualTypeOf<StopKind>();
    expectTypeOf<PausedInfo>().toHaveProperty('by').toBeString();
  });
});

describe('2A.2 정지 3종 — Dispatcher', () => {
  it('지금 멈추기 → paused{reason:user, at, by} + session_paused 기록', async () => {
    const seen: LogRecord[] = [];
    const off = log.subscribe((r) => seen.push(r));
    const d = mk();
    const s = d.dispatch({ agent: '/qa', prompt: '고쳐 줘' });
    await Promise.resolve();
    const r = await d.stopNow(s.sessionId);
    off();
    expect(r).toEqual({ sessionId: s.sessionId, kind: 'stop-now', state: 'paused' });
    const now = d.get(s.sessionId)!;
    expect(now.status).toBe('paused');
    expect(now.paused).toMatchObject({ reason: 'user', by: 'user' });
    expect(Date.parse(now.paused!.at)).not.toBeNaN();
    const ev = seen.find((e) => e.type === 'session_paused' && e.sessionId === s.sessionId)!;
    expect(ev).toMatchObject({ kind: 'stop-now', nodeId: 'build', paused: { reason: 'user' } });
    expect(seen.some((e) => e.type === 'session_end' && e.sessionId === s.sessionId)).toBe(false);
    // 이미 멈춘 세션
    expect((await d.stopNow(s.sessionId)).state).toBe('not_running');
    expect(d.pause(s.sessionId).state).toBe('not_running');
  });

  it('일시정지 → pausing (안전한 지점을 기다림) + pause_requested', async () => {
    const seen: LogRecord[] = [];
    const off = log.subscribe((r) => seen.push(r));
    const d = mk();
    const s = d.dispatch({ agent: '/qa', prompt: 'x' });
    expect(d.pause(s.sessionId)).toEqual({ sessionId: s.sessionId, kind: 'pause', state: 'pausing' });
    expect(d.get(s.sessionId)).toMatchObject({ status: 'running', pausing: true });
    // 두 번 눌러도 기록은 한 번
    d.pause(s.sessionId);
    off();
    expect(seen.filter((e) => e.type === 'pause_requested' && e.sessionId === s.sessionId)).toHaveLength(1);
    await d.stopNow(s.sessionId);
  });

  it('전체 정지 → 실행 중 세션 전부 paused', async () => {
    const d = mk();
    const a = d.dispatch({ agent: 'qa', prompt: '1' });
    const b = d.dispatch({ agent: 'qa', prompt: '2' });
    expect(d.runningCount()).toBe(2);
    const rs = await d.stopAll();
    expect(rs.map((r) => [r.sessionId, r.kind, r.state])).toEqual([
      [a.sessionId, 'stop-all', 'paused'],
      [b.sessionId, 'stop-all', 'paused'],
    ]);
    expect(d.runningCount()).toBe(0);
    expect(d.sessions().every((x) => x.status === 'paused')).toBe(true);
  });

  it('없는 세션은 not_found', () => {
    expect(() => mk().pause('nope')).toThrow(expect.objectContaining({ code: 'not_found' }));
  });
});

describe('2A.2 정지 3종 — API', () => {
  it('POST pause 202 · stop 200 · stop-all 200 · 404 · 409', async () => {
    const d = mk();
    const api = await bootApi({ routes: (app) => registerSessionRoutes(app, d) });
    try {
      const post = (p: string) => api.post(p, {}, api.auth);
      const a = d.dispatch({ agent: 'qa', prompt: 'a' });
      const b = d.dispatch({ agent: 'qa', prompt: 'b' });
      const c = d.dispatch({ agent: 'qa', prompt: 'c' });
      const p = await post(`/api/sessions/${a.sessionId}/pause`);
      expect(p.status).toBe(202);
      expect(await p.json()).toMatchObject({ state: 'pausing' });
      const st = await post(`/api/sessions/${a.sessionId}/stop`);
      expect(st.status).toBe(200);
      expect(await st.json()).toMatchObject({ state: 'paused', kind: 'stop-now' });
      expect((await post(`/api/sessions/${a.sessionId}/stop`)).status).toBe(409);
      expect((await post('/api/sessions/nope/pause')).status).toBe(404);
      const all = await post('/api/sessions/stop-all');
      expect(all.status).toBe(200);
      const body = (await all.json()) as { results: StopResult[] };
      expect(body.results.map((r) => r.sessionId).sort()).toEqual([b.sessionId, c.sessionId].sort());
      const list = (await (await api.get('/api/sessions', api.auth)).json()) as {
        sessions: { status: string }[];
      };
      expect(list.sessions.every((s) => s.status === 'paused')).toBe(true);
    } finally {
      await api.close();
    }
  });
});
