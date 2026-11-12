// @features F-085 F-086 F-087 F-097 F-104 F-110
import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Dispatcher } from '../src/dispatch.js';
import { runCli } from '../src/projects/cli-commands.js';
import { ProjectStore } from '../src/projects/project-store.js';
import { SessionRegistry } from '../src/projects/session-registry.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const req = (
  api: Awaited<ReturnType<typeof bootApi>>,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> =>
  fetch(api.server.url + path, {
    method,
    headers: { ...api.auth, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, json: (await r.json()) as Record<string, unknown> }));

describe('0B.10 프로젝트 API', () => {
  it('GET/POST/PATCH /api/projects, GET /:id/sessions, POST /:id/relink', async () => {
    const t = tempDir('hx-projapi2-');
    closers.push(() => t.cleanup());
    const home = join(t.dir, 'home');
    const projects = new ProjectStore({ home });
    const sessions = new SessionRegistry({ home, projects });
    const dispatch = new Dispatcher({
      sessions,
      resolve: () => undefined,
      run: async () => ({ status: 'x' }),
    });
    const revealed: string[] = [];
    const api = await bootApi({
      server: { dispatch, projects: { projects, sessions, reveal: (p) => revealed.push(p) } },
    });
    closers.push(() => api.close());
    const dir = join(t.dir, 'web-app');
    mkdirSync(dir);

    expect((await req(api, 'GET', '/api/projects')).json).toMatchObject({ projects: [], noProject: 0 });
    const created = await req(api, 'POST', '/api/projects', { path: dir });
    expect(created.status).toBe(201);
    const p = (created.json as { project: { id: string; name: string } }).project;
    expect(p.name).toBe('web-app');
    expect((await req(api, 'POST', '/api/projects', { path: dir })).json).toMatchObject({ existed: true });
    expect((await req(api, 'POST', '/api/projects', { path: '/etc' })).status).toBe(400);

    const list = await req(api, 'GET', '/api/projects');
    expect(list.json).toMatchObject({ currentId: p.id, projects: [{ id: p.id, sessionCount: 0 }] });

    const patched = await req(api, 'PATCH', `/api/projects/${p.id}`, {
      name: '웹 앱',
      pinned: true,
      defaults: { engine: 'codex', mode: '' },
    });
    expect(patched.json).toMatchObject({
      project: { name: '웹 앱', pinned: true, defaults: { engine: 'codex' } },
    });
    expect((await req(api, 'PATCH', '/api/projects/nope', { name: 'x' })).status).toBe(404);

    // 초안 → 첫 메시지 → 프로젝트 세션 목록
    const draft = await req(api, 'POST', '/api/sessions', { projectId: p.id });
    expect(draft.status).toBe(201);
    expect(draft.json).toMatchObject({ draft: true, projectId: p.id, engine: 'codex' });
    expect((await req(api, 'GET', `/api/projects/${p.id}/sessions`)).json).toEqual({ sessions: [] });
    await req(api, 'POST', `/api/sessions/${String(draft.json.id)}/commit`, { text: '첫 메시지' });
    const ss = await req(api, 'GET', `/api/projects/${p.id}/sessions`);
    expect((ss.json.sessions as { id: string }[]).map((s) => s.id)).toEqual([draft.json.id]);
    expect((await req(api, 'GET', '/api/projects/nope/sessions')).status).toBe(404);

    // 다시 연결
    renameSync(dir, join(t.dir, 'web-app-2'));
    expect((await req(api, 'GET', '/api/projects')).json).toMatchObject({ projects: [{ missing: true }] });
    const relinked = await req(api, 'POST', `/api/projects/${p.id}/relink`, {
      path: join(t.dir, 'web-app-2'),
    });
    expect(relinked.json).toMatchObject({ project: { id: p.id, missing: false, sessionCount: 1 } });
    const other = join(t.dir, 'plain');
    mkdirSync(other);
    expect((await req(api, 'POST', `/api/projects/${p.id}/relink`, { path: other })).json).toMatchObject({
      error: 'no_marker',
    });

    // 그 밖: 추천·순서·고르기·탐색기·정보·임시·빼기
    expect((await req(api, 'POST', '/api/projects/suggest-root', { path: other })).json).toMatchObject({
      suggest: false,
    });
    await req(api, 'POST', `/api/projects/${p.id}/reveal`);
    expect(revealed).toEqual([join(t.dir, 'web-app-2')]);
    expect((await req(api, 'GET', `/api/projects/${p.id}/info`)).json).toMatchObject({ hasAgentsMd: false });
    const scratch = await req(api, 'POST', '/api/projects/scratch');
    const sid = (scratch.json.project as { id: string }).id;
    expect(scratch.json.project).toMatchObject({ name: '임시 작업 1', scratch: true });
    expect((await req(api, 'POST', '/api/projects/order', { ids: [sid, p.id] })).status).toBe(200);
    expect((await req(api, 'POST', '/api/projects/current', { id: p.id })).json).toMatchObject({
      currentId: p.id,
    });
    expect((await req(api, 'DELETE', `/api/projects/${sid}`)).json).toEqual({ removed: sid });
  });
});

describe('0B.37 CLI로 만든 세션', () => {
  it('harness-x run → 서버 createSession() → 3초 안에 /ws/events로 session_registered', async () => {
    const t = tempDir('hx-projcli-');
    closers.push(() => t.cleanup());
    const home = join(t.dir, 'home');
    const projects = new ProjectStore({ home });
    const dir = join(t.dir, 'cli-app');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const p = projects.add(dir).project;
    // 서버와 같은 홈의 등록부 (서버 이벤트 로그로 실시간 반영)
    const logRef: { l?: { append(r: never): unknown } } = {};
    const sessions = new SessionRegistry({
      home,
      projects,
      log: { append: (r) => logRef.l?.append(r as never) },
    });
    const dispatch = new Dispatcher({
      sessions,
      resolve: (n) => ({
        name: n.replace(/^\//, ''),
        command: `/${n.replace(/^\//, '')}`,
        displayName: n,
        pipeline: { name: 'p', nodes: [], edges: [] } as never,
      }),
      run: async () => ({ status: 'completed' }),
    });
    const api = await bootApi({ tokenFile: join(home, 'run', 'token'), server: { dispatch } });
    closers.push(() => api.close());
    logRef.l = api.env.log;

    const ws = new WebSocket(`${api.server.url.replace('http', 'ws')}/ws/events?token=${api.server.token}`);
    closers.push(() => ws.close());
    const seen = new Promise<Record<string, unknown>>((res) =>
      ws.on('message', (m) => {
        const r = JSON.parse(String(m)) as Record<string, unknown>;
        if (r.type === 'session_registered') res(r);
      }),
    );
    await new Promise((r) => ws.once('open', r));
    const out: string[] = [];
    const started = Date.now();
    const code = await runCli(['/review', '버그', '찾아', '줘', '--port', String(api.server.port)], {
      home,
      cwd: join(dir, 'sub'),
      io: { out: (s) => out.push(s), err: (s) => out.push(s) },
    });
    expect(code).toBe(0);
    const rec = await seen;
    expect(Date.now() - started).toBeLessThan(3000);
    expect(rec.session).toMatchObject({ origin: 'cli', projectId: p.id, title: '버그 찾아 줘' });
    expect(out.join('')).toContain('세션을 시작했어요');
  });
});
