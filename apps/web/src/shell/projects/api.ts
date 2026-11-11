import type { HarnessApiClient, PickFolderResponse } from '../../api/client.js';

/** 커널 projects/schema.ts와 짝 (T-101 0-2) */
export interface ProjectDefaults {
  engine?: string;
  model?: string;
  mode?: string;
  permission?: string;
  agent?: string;
}

export interface ProjectView {
  id: string;
  name: string;
  rootPath: string;
  gitRoot?: string;
  branch?: string;
  createdAt: string;
  lastOpenedAt: string;
  pinned: boolean;
  order: number;
  missing: boolean;
  scratch?: boolean;
  defaults?: ProjectDefaults;
  sessionCount?: number;
}

export type SessionState = 'running' | 'needs-approval' | 'paused' | 'done' | 'idle' | 'error';

export interface SessionRecordView {
  id: string;
  projectId: string | null;
  title: string;
  titleLocked: boolean;
  status: SessionState;
  engine?: string;
  model?: string;
  mode?: string;
  permission?: string;
  agent?: string;
  agentIcon?: string;
  cwd: string;
  origin: string;
  draft: boolean;
  messageCount: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  doneAt?: string;
}

export interface ProjectsResponse {
  projects: ProjectView[];
  currentId?: string;
  noProject: number;
}

export interface RootSuggestion {
  path: string;
  gitRoot?: string;
  suggest: boolean;
  message?: string;
}

export interface ProjectInfo {
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
  git: boolean;
  branch?: string;
}

export interface ChangeProjectResult {
  session: SessionRecordView;
  replaced: boolean;
  message?: string;
}

/** 화면이 쓰는 프로젝트·세션 API (테스트에서는 가짜로 바꿔 끼운다) */
export interface ProjectsApi {
  list(): Promise<ProjectsResponse>;
  sessions(): Promise<{ sessions: SessionRecordView[] }>;
  add(path: string): Promise<{ project: ProjectView; existed: boolean }>;
  suggestRoot(path: string): Promise<RootSuggestion>;
  scratch(): Promise<{ project: ProjectView }>;
  patch(
    id: string,
    body: { name?: string; pinned?: boolean; defaults?: ProjectDefaults },
  ): Promise<{
    project: ProjectView;
  }>;
  remove(id: string): Promise<unknown>;
  order(ids: string[]): Promise<{ projects: ProjectView[] }>;
  setCurrent(id: string | undefined): Promise<unknown>;
  relink(id: string, path: string, force?: boolean): Promise<{ project: ProjectView }>;
  move(id: string, path: string): Promise<{ project: ProjectView }>;
  reveal(id: string): Promise<unknown>;
  info(id: string): Promise<ProjectInfo>;
  createDraft(projectId: string): Promise<SessionRecordView>;
  commit(id: string, text: string): Promise<SessionRecordView>;
  leave(id: string): Promise<{ discarded: boolean }>;
  changeProject(id: string, projectId: string): Promise<ChangeProjectResult>;
  patchSession(id: string, body: { title?: string; archived?: boolean }): Promise<SessionRecordView>;
  removeSession(id: string): Promise<unknown>;
  pickFolder(initialPath?: string): Promise<PickFolderResponse>;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const enc = encodeURIComponent;

export function projectsApi(
  c: HarnessApiClient,
  pick?: (initialPath?: string) => Promise<PickFolderResponse>,
): ProjectsApi {
  const r = c.request.bind(c);
  return {
    list: () => r('/api/projects'),
    sessions: () => r('/api/session-records'),
    add: (path) => r('/api/projects', { method: 'POST', ...json({ path }) }),
    suggestRoot: (path) => r('/api/projects/suggest-root', { method: 'POST', ...json({ path }) }),
    scratch: () => r('/api/projects/scratch', { method: 'POST', ...json({}) }),
    patch: (id, body) => r(`/api/projects/${enc(id)}`, { method: 'PATCH', ...json(body) }),
    remove: (id) => r(`/api/projects/${enc(id)}`, { method: 'DELETE' }),
    order: (ids) => r('/api/projects/order', { method: 'POST', ...json({ ids }) }),
    setCurrent: (id) => r('/api/projects/current', { method: 'POST', ...json({ id: id ?? null }) }),
    relink: (id, path, force) =>
      r(`/api/projects/${enc(id)}/relink`, {
        method: 'POST',
        ...json({ path, ...(force ? { force } : {}) }),
      }),
    move: (id, path) => r(`/api/projects/${enc(id)}/move`, { method: 'POST', ...json({ path }) }),
    reveal: (id) => r(`/api/projects/${enc(id)}/reveal`, { method: 'POST', ...json({}) }),
    info: (id) => r(`/api/projects/${enc(id)}/info`),
    createDraft: (projectId) => r('/api/sessions', { method: 'POST', ...json({ projectId }) }),
    commit: (id, text) => r(`/api/sessions/${enc(id)}/commit`, { method: 'POST', ...json({ text }) }),
    leave: (id) => r(`/api/sessions/${enc(id)}/leave`, { method: 'POST', ...json({}) }),
    changeProject: (id, projectId) =>
      r(`/api/sessions/${enc(id)}/project`, { method: 'POST', ...json({ projectId }) }),
    patchSession: (id, body) => r(`/api/sessions/${enc(id)}`, { method: 'PATCH', ...json(body) }),
    removeSession: (id) => r(`/api/sessions/${enc(id)}`, { method: 'DELETE' }),
    pickFolder: pick ?? ((p) => c.pickFolder(p)),
  };
}
