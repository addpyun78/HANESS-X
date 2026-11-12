import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Dispatcher } from '../src/dispatch.js';
import { ProjectStore } from '../src/projects/project-store.js';
import { SessionRegistry } from '../src/projects/session-registry.js';
import { stageProgressLabels, stageTreeResolver } from '../src/stage-progress.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const stage = (stageId: string, status: string, items: string[] = []) => ({
  stageId,
  title: stageId,
  kind: 'role',
  status,
  items: items.map((s, k) => ({ id: `${stageId}${k}`, title: 'x', status: s })),
  children: [],
});

describe('4F.8 세션 목록 API에 단계 진행 "단계 2/3"', () => {
  it('stages.json이 있고 단계가 2개 이상인 세션만', async () => {
    const t = tempDir('hx-stage-route-');
    closers.push(() => t.cleanup());
    const home = join(t.dir, 'home');
    const ws = join(t.dir, 'ws');
    mkdirSync(ws);
    const projects = new ProjectStore({ home });
    const sessions = new SessionRegistry({ home, projects });
    const p = projects.add(ws).project;
    const a = sessions.createSession({ origin: 'ui', projectId: p.id, firstMessage: '세 단계 일' });
    const b = sessions.createSession({ origin: 'ui', projectId: p.id, firstMessage: '그냥 질문' });
    const write = (id: string, stages: unknown[]) => {
      const dir = join(ws, '.harness-x', 'sessions', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'stages.json'), JSON.stringify({ stages }));
    };
    write(a.id, [
      stage('plan', 'done', ['done']),
      stage('build', 'running', ['done', 'todo']),
      stage('test', 'expected'),
    ]);
    write(b.id, [{ ...stage('task', 'running', ['todo']), kind: 'task' }]);
    const tree = stageTreeResolver(ws);
    const dispatch = new Dispatcher({
      sessions,
      resolve: () => undefined,
      run: async () => ({ status: 'x' }),
    });
    const api = await bootApi({
      server: {
        dispatch,
        projects: {
          projects,
          sessions,
          stageProgress: (id) => {
            const x = tree(id);
            return x ? stageProgressLabels(x).short : null;
          },
        },
      },
    });
    closers.push(() => api.close());
    const r = await fetch(`${api.server.url}/api/projects/${p.id}/sessions`, { headers: api.auth });
    const list = ((await r.json()) as { sessions: { id: string; stageProgress?: string }[] }).sessions;
    expect(list.find((s) => s.id === a.id)?.stageProgress).toBe('단계 2/3');
    expect(list.find((s) => s.id === b.id)?.stageProgress).toBeUndefined();
    expect(stageProgressLabels(tree(a.id)!).resume).toBe('단계 2/3 · 항목 1/2');
  });
});
