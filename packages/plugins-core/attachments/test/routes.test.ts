import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Dispatcher, ProjectStore, SessionRegistry } from '@harness-x/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { bootApi } from '../../../kernel/test/api-fixtures.js';
import { MESSAGES, registerAttachmentRoutes, type RouteApp } from '../src/index.js';
import { tempProject } from './helpers.js';

const closers: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

/** 실제 커널 API 서버 + 0-2 프로젝트·세션 저장소 + 첨부 라우트 (cli.ts와 같은 연결) */
async function boot() {
  const t = tempProject('hx-att-api-');
  closers.push(t.cleanup);
  const home = join(t.root, 'home');
  const projects = new ProjectStore({ home });
  const sessions = new SessionRegistry({ home, projects });
  const dispatch = new Dispatcher({ sessions, resolve: () => undefined, run: async () => ({ status: 'x' }) });
  const api = await bootApi({
    server: {
      dispatch,
      projects: { projects, sessions },
      routes: (app) =>
        registerAttachmentRoutes(app as unknown as RouteApp, {
          session: (id) => {
            const s = sessions.get(id);
            if (!s) return undefined;
            const p = s.projectId ? projects.get(s.projectId) : undefined;
            return { draft: s.draft, ...(p ? { projectRoot: p.rootPath } : {}) };
          },
          commitDraft: (id, text) => sessions.commitDraft(id, text),
        }),
    },
  });
  closers.push(() => api.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(api.server.url + path, {
      method,
      headers: { ...api.auth, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  return { root: t.root, projects, sessions, call };
}

const file = (name: string, text: string) => ({ name, dataBase64: Buffer.from(text).toString('base64') });

describe('1A.7 초안 세션(0B.12)에 파일을 놓으면 그 순간 정식 저장 — 실제 0-2 세션 저장소', () => {
  it('첨부만 하고 다른 세션으로 옮겨도 세션·첨부가 남는다', async () => {
    const b = await boot();
    const dir = join(b.root, 'house');
    mkdirSync(dir);
    const p = (await b.call('POST', '/api/projects', { path: dir })).json.project as { id: string };
    const draft = (await b.call('POST', '/api/sessions', { projectId: p.id })).json as {
      session?: { id: string };
    };
    const draftId = draft.session?.id ?? (draft as unknown as { id: string }).id;
    expect(b.sessions.get(draftId)?.draft).toBe(true);

    const up = await b.call('POST', `/api/sessions/${draftId}/attachments`, {
      files: [file('메모.txt', '첨부만')],
    });
    expect(up.status).toBe(200);
    expect(up.json.savedDraft).toBe(true);
    const att = (up.json.attachments as { storedPath: string; sessionId: string }[])[0]!;
    expect(att.storedPath.startsWith(join(dir, '.harness-x', 'attachments', draftId))).toBe(true);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.harness-x/attachments/');

    // 다른 세션으로 이동: 초안이었다면 지워졌겠지만 정식 저장됐으므로 남는다
    expect(b.sessions.leave(draftId)).toBe(false);
    const other = (await b.call('POST', '/api/sessions', { projectId: p.id })).json as {
      session?: { id: string };
    };
    expect(other).toBeTruthy();
    expect(b.sessions.get(draftId)).toMatchObject({ draft: false });
    const list = await b.call('GET', `/api/sessions/${draftId}/attachments`);
    expect((list.json.attachments as { originalName: string }[]).map((a) => a.originalName)).toEqual([
      '메모.txt',
    ]);
    expect(existsSync(att.storedPath)).toBe(true);
  });
});

describe('1A.8 프로젝트를 안 고른 세션이면 저장하지 않고 "어디서 작업할까요?" 안내 (화면은 카드부터)', () => {
  it('프로젝트 없는 세션 → 409 no_project, 없는 세션 → 404', async () => {
    const b = await boot();
    const s = b.sessions.createSession({ origin: 'ui', projectId: null });
    const r = await b.call('POST', `/api/sessions/${s.id}/attachments`, { files: [file('a.txt', 'a')] });
    expect(r).toMatchObject({ status: 409, json: { error: 'no_project', message: MESSAGES.noProject } });
    expect(
      (await b.call('POST', '/api/sessions/nope/attachments', { files: [file('a.txt', 'a')] })).status,
    ).toBe(404);
  });
});
