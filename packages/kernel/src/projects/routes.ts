import { spawn } from 'node:child_process';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ProjectError, type ProjectStore } from './project-store.js';
import { SessionError, type SessionRegistry } from './session-registry.js';
import { ProjectDefaultsSchema, type Project } from './schema.js';

/**
 * T-101 0B.10 프로젝트 API · 0B.11~0B.19 초안 세션 API
 *   GET    /api/projects                     → { projects, currentId?, noProject: n }
 *   POST   /api/projects {path, name?}       → 0B.7 { project, existed }
 *   POST   /api/projects/suggest-root {path} → 0B.6 { path, gitRoot?, suggest, message? }
 *   POST   /api/projects/scratch             → 0B.16 임시 작업 공간
 *   POST   /api/projects/order {ids}         → 0B.26 끌어서 바꾼 순서
 *   POST   /api/projects/current {id|null}   → 0B.31 지금 고른 프로젝트
 *   PATCH  /api/projects/:id {name?, pinned?, defaults?}
 *   DELETE /api/projects/:id                 → 목록에서 빼기 (파일은 그대로)
 *   GET    /api/projects/:id/sessions
 *   GET    /api/projects/:id/info            → AGENTS.md / CLAUDE.md 있음
 *   POST   /api/projects/:id/relink {path, force?}
 *   POST   /api/projects/:id/move {path}     → 임시 작업 공간 옮기기
 *   POST   /api/projects/:id/reveal          → 탐색기에서 열기
 * 세션(초안): POST /api/sessions(agent 없을 때)는 sessions-routes가 여기 drafts로 넘긴다.
 *   POST   /api/sessions/:id/commit {text}   → 첫 메시지: 저장·사이드바 등록
 *   POST   /api/sessions/:id/leave           → 초안이면 지움
 *   POST   /api/sessions/:id/project {projectId}
 *   POST   /api/sessions/:id/title-suggestion {title}
 *   PATCH  /api/sessions/:id {title?, archived?}
 *   DELETE /api/sessions/:id
 *   GET    /api/session-records              → { sessions } (사이드바용 정식 세션 전부)
 */

export interface ProjectRoutesOptions {
  projects: ProjectStore;
  sessions: SessionRegistry;
  /** 탐색기에서 열기 (기본: explorer.exe / open / xdg-open) */
  reveal?: (path: string) => void;
  /** T-101 4F.8 세션 줄의 단계 진행 "단계 2/3" (단계 1개면 null) */
  stageProgress?: (sessionId: string) => string | null | undefined;
}

const PROJECT_STATUS: Record<string, number> = {
  invalid: 400,
  rejected: 400,
  not_found: 404,
  marker_mismatch: 409,
  no_marker: 409,
  not_scratch: 409,
  not_empty: 409,
};
const SESSION_STATUS: Record<string, number> = {
  invalid: 400,
  no_project: 409,
  not_found: 404,
  project_locked: 409,
  running: 409,
};

export function sendProjectError(reply: FastifyReply, err: unknown) {
  if (err instanceof ProjectError)
    return reply.code(PROJECT_STATUS[err.code] ?? 400).send({ error: err.code, message: err.message });
  if (err instanceof SessionError)
    return reply.code(SESSION_STATUS[err.code] ?? 400).send({ error: err.code, message: err.message });
  throw err;
}

function defaultReveal(path: string) {
  const cmd =
    process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'darwin'
        ? 'open'
        : process.env.WSL_DISTRO_NAME
          ? 'explorer.exe'
          : 'xdg-open';
  const arg = cmd === 'explorer.exe' && process.platform !== 'win32' ? toWinPath(path) : path;
  const child = spawn(cmd, [arg], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function toWinPath(p: string): string {
  const m = /^\/mnt\/([a-z])(\/.*)?$/i.exec(p);
  return m ? `${m[1]!.toUpperCase()}:${(m[2] ?? '\\').replace(/\//g, '\\')}` : p;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function registerProjectRoutes(app: FastifyInstance, o: ProjectRoutesOptions): void {
  const { projects, sessions } = o;
  const withStage = <T extends { id: string }>(r: T): T & { stageProgress?: string } => {
    const sp = o.stageProgress?.(r.id);
    return sp ? { ...r, stageProgress: sp } : r;
  };
  const view = (p: Project) => ({
    ...p,
    sessionCount: sessions.list({ projectId: p.id }).length,
  });

  app.get('/api/projects', async () => {
    const list = projects.list();
    const current = projects.current();
    return {
      projects: list.map(view),
      ...(current ? { currentId: current.id } : {}),
      noProject: sessions.list({ projectId: null }).length,
    };
  });

  app.post('/api/projects', async (req, reply) => {
    const b = (req.body ?? {}) as { path?: unknown; name?: unknown };
    try {
      const r = projects.add(str(b.path), typeof b.name === 'string' && b.name ? { name: b.name } : {});
      return reply.code(r.existed ? 200 : 201).send({ project: view(r.project), existed: r.existed });
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.post('/api/projects/suggest-root', async (req, reply) => {
    try {
      return projects.suggestRoot(str((req.body as { path?: unknown } | undefined)?.path));
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.post('/api/projects/scratch', async (_req, reply) => {
    try {
      return reply.code(201).send({ project: view(projects.createScratch()) });
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.post('/api/projects/order', async (req, reply) => {
    const ids = (req.body as { ids?: unknown } | undefined)?.ids;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string'))
      return reply.code(400).send({ error: 'invalid', message: 'ids가 필요해요' });
    try {
      return { projects: projects.reorder(ids).map(view) };
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.post('/api/projects/current', async (req, reply) => {
    const id = (req.body as { id?: unknown } | undefined)?.id;
    try {
      const p = projects.setCurrent(typeof id === 'string' && id ? id : undefined);
      return p ? { currentId: p.id, project: view(p) } : {};
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.patch('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { name?: unknown; pinned?: unknown; defaults?: unknown };
    try {
      if (typeof b.name === 'string') projects.rename(id, b.name);
      if (typeof b.pinned === 'boolean') projects.setPinned(id, b.pinned);
      if (b.defaults !== undefined) {
        const raw = Object.fromEntries(
          Object.entries((b.defaults ?? {}) as Record<string, unknown>).filter(
            ([, v]) => typeof v === 'string' && v.trim(),
          ),
        );
        const d = ProjectDefaultsSchema.safeParse(raw);
        if (!d.success) return reply.code(400).send({ error: 'invalid', message: '기본값 형식이 달라요' });
        projects.setDefaults(id, d.data);
      }
      return { project: view(projects.require(id)) };
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      projects.remove(id);
      return { removed: id };
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.get('/api/projects/:id/sessions', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!projects.get(id)) return reply.code(404).send({ error: 'not_found' });
    return { sessions: sessions.list({ projectId: id }).map(withStage) };
  });

  app.get('/api/projects/:id/info', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return projects.info(id);
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.post('/api/projects/:id/relink', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { path?: unknown; force?: unknown };
    try {
      return { project: view(projects.relink(id, str(b.path), { force: b.force === true })) };
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.post('/api/projects/:id/move', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { project: view(projects.moveScratch(id, str((req.body as { path?: unknown })?.path))) };
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.post('/api/projects/:id/reveal', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const p = projects.require(id);
      (o.reveal ?? defaultReveal)(p.rootPath);
      return { opened: p.rootPath };
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  // ── 세션 ──────────────────────────────────────────────────
  app.get('/api/session-records', async () => ({ sessions: sessions.list().map(withStage) }));

  app.post('/api/sessions/:id/commit', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return sessions.commitDraft(id, str((req.body as { text?: unknown } | undefined)?.text));
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.post('/api/sessions/:id/leave', async (req) => {
    const { id } = req.params as { id: string };
    return { discarded: sessions.leave(id) };
  });

  app.post('/api/sessions/:id/project', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return sessions.changeProject(id, str((req.body as { projectId?: unknown } | undefined)?.projectId));
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.post('/api/sessions/:id/title-suggestion', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return sessions.suggestTitle(id, str((req.body as { title?: unknown } | undefined)?.title));
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.patch('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { title?: unknown; archived?: unknown };
    try {
      let s = sessions.get(id);
      if (!s) return reply.code(404).send({ error: 'not_found' });
      if (typeof b.title === 'string') s = sessions.rename(id, b.title);
      if (typeof b.archived === 'boolean') s = sessions.archive(id, b.archived);
      return s;
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });

  app.delete('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      sessions.remove(id);
      return { removed: id };
    } catch (err) {
      return sendProjectError(reply, err);
    }
  });
}

/** POST /api/sessions {projectId?} (에이전트 없음) → 초안 세션 (0B.11) */
export function createDraftFromRequest(sessions: SessionRegistry, body: Record<string, unknown>) {
  return sessions.createSession({
    origin: body.origin === 'resume' ? 'resume' : 'ui',
    draft: true,
    ...(typeof body.projectId === 'string' && body.projectId ? { projectId: body.projectId } : {}),
  });
}
