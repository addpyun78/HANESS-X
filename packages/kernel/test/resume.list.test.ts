import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { registerResumeRoutes } from '../src/api/resume-routes.js';
import { EventLog, type LogRecord } from '../src/event-log.js';
import { findResumableSessions, resumableForProject } from '../src/resume.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

const tmp = tempDir('hx-resume-list-');
afterAll(() => tmp.cleanup());

let n = 0;
const rec = (sessionId: string, ts: string, type: string, body: Record<string, unknown> = {}): LogRecord => ({
  id: `r${n++}`,
  ts,
  sessionId,
  type,
  ...body,
});
const created = (id: string, projectId: string, ts = '2026-11-10T00:00:00.000Z') =>
  rec(id, ts, 'session_created', {
    agent: 'design-qa',
    command: '/design-qa',
    displayName: '디자인 검수',
    icon: '🎨',
    prompt: `헤더 ${id}`,
    nodeCount: 4,
    projectId,
  });
const pausedAt = (id: string, at: string, reason = 'user', extra: Record<string, unknown> = {}) =>
  rec(id, at, 'session_paused', { kind: 'pause', paused: { reason, at, by: 'user' }, ...extra });

function seed(log: EventLog) {
  // s1: p1, 노드 1/4 끝난 뒤 사용자가 멈춤
  for (const r of [
    created('s1', 'p1'),
    rec('s1', '2026-11-10T00:01:00.000Z', 'node_end', { nodeId: 'plan', status: 'completed' }),
    rec('s1', '2026-11-10T00:01:30.000Z', 'tool_result', {
      engineId: 'codex',
      callId: 'c',
      ok: true,
      output: 'ok',
    }),
    pausedAt('s1', '2026-11-11T09:00:00.000Z', 'user', {
      progress: 0.25,
      nodeId: 'build',
      item: { id: 'I-2', interrupted: true },
    }),
  ])
    log.append(r);
  // s2: 멈췄다가 이어감 → 목록에 없음
  for (const r of [
    created('s2', 'p1'),
    pausedAt('s2', '2026-11-11T08:00:00.000Z'),
    rec('s2', '2026-11-11T08:10:00.000Z', 'session_resumed'),
  ])
    log.append(r);
  // s3: 다른 프로젝트, 사용량 한도
  for (const r of [created('s3', 'p2'), pausedAt('s3', '2026-11-12T01:00:00.000Z', 'quota')]) log.append(r);
  // s4: 비정상 종료 (턴이 turn_end 없이 끊김) → crash
  for (const r of [
    created('s4', 'p1'),
    rec('s4', '2026-11-11T10:00:00.000Z', 'tool_call', {
      engineId: 'claude-code',
      callId: 'x',
      tool: 'write_file',
      input: {},
    }),
  ])
    log.append(r);
  // s5: 끝난 세션
  for (const r of [
    created('s5', 'p1'),
    pausedAt('s5', '2026-11-11T07:00:00.000Z'),
    rec('s5', '2026-11-11T07:30:00.000Z', 'session_end', { status: 'completed' }),
  ])
    log.append(r);
  log.flush();
}

describe('2B.1 프로젝트의 미완료 세션', () => {
  const log = new EventLog({ root: join(tmp.dir, 'logs') });
  seed(log);

  it('멈춘 세션 + 비정상 종료 세션, 멈춘 시각 최신순 (이어간·끝난 세션 제외)', () => {
    const all = findResumableSessions(log);
    expect(all.map((s) => [s.sessionId, s.paused.reason])).toEqual([
      ['s3', 'quota'],
      ['s4', 'crash'],
      ['s1', 'user'],
    ]);
    expect(all.find((s) => s.sessionId === 's1')).toEqual({
      sessionId: 's1',
      projectId: 'p1',
      title: '/design-qa 헤더 s1',
      agent: { name: 'design-qa', command: '/design-qa', displayName: '디자인 검수', icon: '🎨' },
      engineId: 'codex',
      progress: 0.25,
      paused: { reason: 'user', at: '2026-11-11T09:00:00.000Z', by: 'user' },
      nodeId: 'build',
      itemId: 'I-2',
      startedAt: '2026-11-10T00:00:00.000Z',
    });
    expect(all.find((s) => s.sessionId === 's4')).toMatchObject({
      engineId: 'claude-code',
      paused: { reason: 'crash', by: 'kernel', at: '2026-11-11T10:00:00.000Z' },
    });
  });

  it('프로젝트 id → 그 프로젝트 것만', () => {
    const all = findResumableSessions(log);
    expect(resumableForProject(all, 'p1').map((s) => s.sessionId)).toEqual(['s4', 's1']);
    expect(resumableForProject(all, 'p2').map((s) => s.sessionId)).toEqual(['s3']);
    expect(resumableForProject(all, 'none')).toEqual([]);
  });

  it('GET /api/resume?projectId=p1', async () => {
    const api = await bootApi({ routes: (app) => registerResumeRoutes(app, { log }) });
    try {
      const r = await api.get('/api/resume?projectId=p1', api.auth);
      expect(r.status).toBe(200);
      const body = (await r.json()) as { sessions: { sessionId: string }[] };
      expect(body.sessions.map((s) => s.sessionId)).toEqual(['s4', 's1']);
      const all = (await (await api.get('/api/resume', api.auth)).json()) as { sessions: unknown[] };
      expect(all.sessions).toHaveLength(3);
    } finally {
      await api.close();
    }
  });
});
