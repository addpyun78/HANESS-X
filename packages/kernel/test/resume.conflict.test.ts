import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EventLog, type LogRecord } from '../src/event-log.js';
import { findResumableSessions } from '../src/resume.js';
import { checkBeforeResume } from '../src/resume-check.js';
import { conflictsFromLog, findOutputConflicts, sessionOutputs } from '../src/resume-conflict.js';
import { tempDir } from './helpers.js';

const tmp = tempDir('hx-conflict-');
afterAll(() => tmp.cleanup());

let n = 0;
const r = (sessionId: string, type: string, body: Record<string, unknown> = {}): LogRecord => ({
  id: `c${n++}`,
  ts: `2026-11-12T0${n % 10}:00:00.000Z`,
  sessionId,
  type,
  ...body,
});
const created = (id: string, projectId: string) =>
  r(id, 'session_created', { agent: 'qa', command: '/qa', prompt: id, nodeCount: 1, projectId });
const wrote = (id: string, path: string) => r(id, 'file_change', { path, change: 'modify' });

describe('2B.8 동시 편집 충돌', () => {
  const log = new EventLog({ root: join(tmp.dir, 'logs') });
  for (const rec of [
    created('paused', 'p1'),
    wrote('paused', 'src/header.tsx'),
    wrote('paused', 'src/footer.tsx'),
    r('paused', 'session_paused', { paused: { reason: 'user', at: '2026-11-12T09:00:00.000Z', by: 'user' } }),
    created('run-same', 'p1'),
    wrote('run-same', 'src/header.tsx'),
    created('run-other-file', 'p1'),
    wrote('run-other-file', 'README.md'),
    created('run-other-project', 'p2'),
    wrote('run-other-project', 'src/header.tsx'),
  ])
    log.append(rec);
  log.flush();

  it('같은 프로젝트 + 같은 산출물 경로를 쓰는 실행 중 세션만 충돌', () => {
    const c = conflictsFromLog(log, 'paused', ['run-same', 'run-other-file', 'run-other-project']);
    expect(c).toEqual([{ sessionId: 'run-same', title: '/qa run-same', paths: ['src/header.tsx'] }]);
  });

  it('충돌이 있으면 점검기가 "끝날 때까지 기다리기"(추천) 제안, 없으면 통과', () => {
    const s = findResumableSessions(log).find((x) => x.sessionId === 'paused')!;
    const withConflict = checkBeforeResume(s, {
      now: new Date('2026-11-12T10:00:00.000Z'),
      conflicts: () => conflictsFromLog(log, 'paused', ['run-same']),
    });
    expect(withConflict.issues[0]).toMatchObject({ check: 'conflict', list: ['src/header.tsx'] });
    expect(withConflict.issues[0]!.choices[0]).toMatchObject({ id: 'wait', recommended: true });
    const none = checkBeforeResume(s, {
      now: new Date('2026-11-12T10:00:00.000Z'),
      conflicts: () => conflictsFromLog(log, 'paused', ['run-other-file', 'run-other-project']),
    });
    expect(none.ok).toBe(true);
  });

  it('프로젝트가 없는 세션은 충돌 판단 안 함, 자기 자신 제외', () => {
    const t = { ...sessionOutputs('x', []), outputs: ['a'] };
    expect(findOutputConflicts(t, [{ sessionId: 'y', projectId: null, title: 'y', outputs: ['a'] }])).toEqual(
      [],
    );
    const me = { sessionId: 'x', projectId: 'p', title: 'x', outputs: ['a'] };
    expect(findOutputConflicts(me, [me])).toEqual([]);
  });
});
