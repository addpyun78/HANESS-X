import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LogRecord } from '../event-log.js';
import { harnessHome } from '../loader.js';
import { toRunMode, type RunMode } from '@harness-x/protocol';
import { resolveSessionDefaults, type GlobalDefaultsSource } from './defaults.js';
import type { ProjectStore } from './project-store.js';
import {
  SessionRecordSchema,
  type Project,
  type SessionOrigin,
  type SessionRecord,
  type SessionState,
} from './schema.js';

/**
 * T-101 0-2 세션 등록부
 * - 0B.37 세션은 `createSession()` 하나로만 만든다: 화면 [+ 새 세션]·`/` 실행(디스패처)·CLI `harness-x run`·이어하기·API.
 *   정식 등록되면 이벤트 로그에 `session_registered`를 남겨 기존 `/ws/events`로 사이드바에 바로 보인다.
 * - 0B.12 초안은 메모리에만 있다. 첫 메시지(commitDraft) 때 저장·등록, 그냥 떠나면(leave) 지운다.
 * - 0B.13 첫 메시지 뒤에는 프로젝트를 바꿀 수 없다.
 * - 0B.39 projectId는 만들 때 직접 저장한다 (표시할 때 경로로 추정하지 않는다).
 * - 0B.9 저장: `<home>/sessions/<id>/session.json`(원본) + `<home>/sessions/index.json`(색인).
 *   시작할 때 색인과 폴더가 다르면 폴더를 다시 읽어 색인을 고친다. 수동: `harness-x reindex`.
 */

export const SESSION_REGISTERED = 'session_registered';
export const SESSION_UPDATED = 'session_updated';
export const SESSION_REMOVED = 'session_removed';

export type SessionErrorCode = 'not_found' | 'no_project' | 'project_locked' | 'running' | 'invalid';

export class SessionError extends Error {
  constructor(
    readonly code: SessionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface CreateSessionInput {
  origin: SessionOrigin;
  /** 없으면 cwd가 속한 프로젝트 → 지금 고른 프로젝트 (draft는 프로젝트가 꼭 있어야 한다) */
  projectId?: string | null;
  /** 없으면 프로젝트 루트 */
  cwd?: string;
  /** 0B.12 초안 (기본 false — 바로 실행되는 / 실행·CLI는 정식) */
  draft?: boolean;
  title?: string;
  agent?: string;
  agentIcon?: string;
  engine?: string;
  model?: string;
  mode?: string;
  permission?: string;
  status?: SessionState;
  /** 첫 메시지(있으면 메시지 수 1, 제목 = 앞 30자) */
  firstMessage?: string;
  /** 옛 세션 가져오기처럼 id를 지켜야 할 때 */
  id?: string;
  /** 디스패치 세션은 'dispatch-' */
  idPrefix?: string;
  idGen?: () => string;
  createdAt?: string;
}

export interface SessionRegistryOptions {
  home?: string;
  /** true면 파일에 쓰지 않는다 (디스패처 단독 테스트 등) */
  memory?: boolean;
  projects?: ProjectStore;
  /** 0B.11/0B.40 전체 기본값 출처 (현재 기본 엔진 → 5번 이후 메인 AI, 3번 이후 기본 모드) */
  defaults?: GlobalDefaultsSource;
  /** 실시간 반영용 (기존 /ws/events) */
  log?: { append(rec: LogRecord): unknown };
  /** 0B.19 AI 제목 제안의 쉬운 말 검사 (기본: 짧고 기호 없는 글) */
  titleCheck?: (title: string) => boolean;
  now?: () => Date;
  idGen?: () => string;
}

export const TITLE_MAX = 30;

/** 0B.19 첫 메시지 앞 30자 */
export function titleFromMessage(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return [...t].length > TITLE_MAX ? [...t].slice(0, TITLE_MAX).join('') + '…' : t;
}

const defaultTitleCheck = (t: string) =>
  [...t].length > 0 && [...t].length <= 40 && !/[`{}<>[\]$\\|]|https?:|\/\//.test(t);

interface IndexFile {
  version: 1;
  sessions: SessionRecord[];
}

export class SessionRegistry extends EventEmitter {
  readonly dir: string;
  readonly indexFile: string;
  private readonly memory: boolean;
  private readonly projects: ProjectStore | undefined;
  private readonly defaults: GlobalDefaultsSource;
  private readonly log: SessionRegistryOptions['log'];
  private readonly titleCheck: (t: string) => boolean;
  private readonly now: () => Date;
  private readonly idGen: () => string;
  private readonly saved = new Map<string, SessionRecord>();
  private readonly drafts = new Map<string, SessionRecord>();
  /** 0B.9 이번 기동에서 색인을 다시 만들었나 */
  readonly reindexed: boolean = false;

  constructor(opts: SessionRegistryOptions = {}) {
    super();
    this.dir = join(opts.home ?? harnessHome(), 'sessions');
    this.indexFile = join(this.dir, 'index.json');
    this.memory = opts.memory ?? false;
    this.projects = opts.projects;
    this.defaults = opts.defaults ?? (() => ({}));
    this.log = opts.log;
    this.titleCheck = opts.titleCheck ?? defaultTitleCheck;
    this.now = opts.now ?? (() => new Date());
    this.idGen = opts.idGen ?? randomUUID;
    if (!this.memory) this.reindexed = this.loadOrRepair();
  }

  // ── 0B.9 색인 ────────────────────────────────────────────
  /** 색인을 읽고, 폴더와 다르면 폴더에서 다시 만든다. 다시 만들었으면 true */
  private loadOrRepair(): boolean {
    const folders = this.folderIds();
    let index: SessionRecord[] | undefined;
    try {
      const raw = JSON.parse(readFileSync(this.indexFile, 'utf8')) as Partial<IndexFile>;
      if (Array.isArray(raw.sessions))
        index = raw.sessions.flatMap((s) => {
          const r = SessionRecordSchema.safeParse(s);
          return r.success ? [r.data] : [];
        });
    } catch {
      index = undefined;
    }
    if (index === undefined && folders.length === 0) return false;
    const same =
      index !== undefined &&
      index.length === folders.length &&
      index.every((s) => folders.includes(s.id)) &&
      index.every((s) => s.updatedAt === this.readFolder(s.id)?.updatedAt);
    if (same) {
      for (const s of index!) this.saved.set(s.id, s);
      return false;
    }
    this.reindex();
    return true;
  }

  /** 폴더(`sessions/<id>/session.json`)를 다시 읽어 색인을 만든다. 복구한 세션 수 */
  reindex(): number {
    this.saved.clear();
    for (const id of this.folderIds()) {
      const s = this.readFolder(id);
      if (s) this.saved.set(id, s);
    }
    this.writeIndex();
    return this.saved.size;
  }

  private folderIds(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(this.dir, d.name, 'session.json')))
      .map((d) => d.name);
  }

  private readFolder(id: string): SessionRecord | undefined {
    try {
      const r = SessionRecordSchema.safeParse(
        JSON.parse(readFileSync(join(this.dir, id, 'session.json'), 'utf8')),
      );
      return r.success ? r.data : undefined;
    } catch {
      return undefined;
    }
  }

  private writeIndex() {
    if (this.memory) return;
    mkdirSync(this.dir, { recursive: true });
    const body: IndexFile = {
      version: 1,
      sessions: [...this.saved.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
    atomicWrite(this.indexFile, JSON.stringify(body, null, 2) + '\n');
  }

  private persist(s: SessionRecord) {
    this.saved.set(s.id, s);
    if (this.memory) return;
    mkdirSync(join(this.dir, s.id), { recursive: true });
    atomicWrite(join(this.dir, s.id, 'session.json'), JSON.stringify(s, null, 2) + '\n');
    this.writeIndex();
  }

  private announce(type: string, s: SessionRecord | { id: string }) {
    this.emit(type, s);
    this.log?.append({
      id: randomUUID(),
      ts: this.now().toISOString(),
      sessionId: s.id,
      type,
      ...('origin' in s ? { session: s } : {}),
    });
  }

  // ── 0B.37 단 하나의 등록 함수 ─────────────────────────────
  createSession(input: CreateSessionInput): SessionRecord {
    const project = this.projectFor(input);
    if (input.draft && !project) throw new SessionError('no_project', '어디서 작업할지 먼저 골라 주세요');
    const d = resolveSessionDefaults(project, this.defaults());
    const at = input.createdAt ?? this.now().toISOString();
    const gen = input.idGen ?? this.idGen;
    const id = input.id ?? `${input.idPrefix ?? ''}${gen()}`;
    if (this.get(id)) throw new SessionError('invalid', `이미 있는 세션: ${id}`);
    const engine = input.engine ?? d.engine;
    const model = input.model ?? d.model;
    const mode = toRunMode(input.mode) ?? toRunMode(d.mode);
    const agent = input.agent ?? d.agent;
    const first = input.firstMessage?.trim();
    const s = SessionRecordSchema.parse({
      id,
      projectId: project?.id ?? null,
      title: input.title ?? (first ? titleFromMessage(first) : ''),
      titleLocked: false,
      status: input.status ?? 'idle',
      ...(engine ? { engine } : {}),
      ...(model ? { model } : {}),
      ...(mode ? { mode } : {}),
      permission: input.permission ?? d.permission,
      ...(agent ? { agent } : {}),
      ...(input.agentIcon ? { agentIcon: input.agentIcon } : {}),
      cwd: input.cwd ?? project?.rootPath ?? process.cwd(),
      origin: input.origin,
      draft: input.draft ?? false,
      messageCount: first ? 1 : 0,
      archived: false,
      createdAt: at,
      updatedAt: at,
      lastActivityAt: at,
    } satisfies SessionRecord);
    if (s.draft) this.drafts.set(s.id, s);
    else {
      this.persist(s);
      this.announce(SESSION_REGISTERED, s);
    }
    return structuredClone(s);
  }

  /** projectId를 정한다: 직접 준 값 → cwd가 속한 프로젝트(만들 때 한 번만, 0B.39) → 지금 고른 프로젝트 */
  private projectFor(input: CreateSessionInput): Project | undefined {
    if (input.projectId === null) return undefined;
    if (input.projectId) {
      const p = this.projects?.get(input.projectId);
      if (!p) throw new SessionError('not_found', `프로젝트를 찾을 수 없어요: ${input.projectId}`);
      return p;
    }
    if (input.cwd) return this.projects?.findForCwd(input.cwd);
    return this.projects?.current();
  }

  // ── 조회 ─────────────────────────────────────────────────
  get(id: string): SessionRecord | undefined {
    const s = this.saved.get(id) ?? this.drafts.get(id);
    return s ? structuredClone(s) : undefined;
  }

  list(q: { projectId?: string | null; drafts?: boolean } = {}): SessionRecord[] {
    const all = [...this.saved.values(), ...(q.drafts ? this.drafts.values() : [])];
    return all
      .filter((s) => q.projectId === undefined || s.projectId === q.projectId)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .map((s) => structuredClone(s));
  }

  private mustSaved(id: string): SessionRecord {
    const s = this.saved.get(id);
    if (!s) throw new SessionError('not_found', `세션을 찾을 수 없어요: ${id}`);
    return s;
  }

  private update(s: SessionRecord, patch: Partial<SessionRecord>, activity = false): SessionRecord {
    const at = this.now().toISOString();
    Object.assign(s, patch, { updatedAt: at }, activity ? { lastActivityAt: at } : {});
    if (s.draft) return structuredClone(s);
    this.persist(s);
    this.announce(SESSION_UPDATED, s);
    return structuredClone(s);
  }

  // ── 0B.12 초안 ───────────────────────────────────────────
  /** 첫 메시지: 초안을 저장·등록 (이미 정식이면 메시지 수·활동 시각만) */
  commitDraft(id: string, text: string): SessionRecord {
    const draft = this.drafts.get(id);
    if (draft) {
      this.drafts.delete(id);
      const at = this.now().toISOString();
      const t = text.trim();
      Object.assign(draft, {
        draft: false,
        messageCount: draft.messageCount + 1,
        updatedAt: at,
        lastActivityAt: at,
        ...(draft.title || !t ? {} : { title: titleFromMessage(t) }),
      });
      this.persist(draft);
      this.announce(SESSION_REGISTERED, draft);
      return structuredClone(draft);
    }
    const s = this.mustSaved(id);
    return this.update(s, { messageCount: s.messageCount + 1 }, true);
  }

  /** 다른 세션으로 갔다: 초안이면 지운다 (빈 세션이 쌓이지 않음). 지웠으면 true */
  leave(id: string): boolean {
    return this.drafts.delete(id);
  }

  /** 0B.13 초안이면 프로젝트 변경, 대화가 있으면 그 폴더에서 새 초안 (원래 세션은 그대로) */
  changeProject(
    id: string,
    projectId: string,
  ): { session: SessionRecord; replaced: boolean; message?: string } {
    const draft = this.drafts.get(id);
    const p = this.projects?.get(projectId);
    if (!p) throw new SessionError('not_found', `프로젝트를 찾을 수 없어요: ${projectId}`);
    if (draft) {
      const d = resolveSessionDefaults(p, this.defaults());
      Object.assign(draft, {
        projectId: p.id,
        cwd: p.rootPath,
        permission: d.permission,
        updatedAt: this.now().toISOString(),
      });
      for (const k of ['engine', 'model', 'agent'] as const) {
        if (d[k]) draft[k] = d[k];
        else delete draft[k];
      }
      if (d.mode) draft.mode = d.mode;
      else delete draft.mode;
      return { session: structuredClone(draft), replaced: false };
    }
    const s = this.mustSaved(id);
    if (s.projectId === projectId) return { session: structuredClone(s), replaced: false };
    const fresh = this.createSession({ origin: 'ui', projectId, draft: true });
    return { session: fresh, replaced: true, message: '그 폴더에서 새 세션을 열게요' };
  }

  // ── 0B.19 제목 ───────────────────────────────────────────
  rename(id: string, title: string): SessionRecord {
    const t = title.trim();
    if (!t) throw new SessionError('invalid', '제목이 비었어요');
    const s = this.saved.get(id) ?? this.drafts.get(id);
    if (!s) throw new SessionError('not_found', `세션을 찾을 수 없어요: ${id}`);
    return this.update(s, { title: t, titleLocked: true });
  }

  /** 첫 응답 뒤 AI 제안: 사용자가 바꾼 적 없고 쉬운 말 검사를 통과할 때만. 적용했으면 applied */
  suggestTitle(id: string, title: string): { session: SessionRecord; applied: boolean } {
    const s = this.mustSaved(id);
    const t = title.replace(/\s+/g, ' ').trim();
    if (s.titleLocked || !this.titleCheck(t)) return { session: structuredClone(s), applied: false };
    return { session: this.update(s, { title: t }), applied: true };
  }

  // ── 상태·보관·삭제 ─────────────────────────────────────────
  setStatus(id: string, status: SessionState): SessionRecord | undefined {
    const s = this.saved.get(id);
    if (!s) return undefined;
    return this.update(
      s,
      { status, ...(status === 'done' ? { doneAt: this.now().toISOString() } : {}) },
      true,
    );
  }

  /** T-101 3E.6 실행 모드 바꾸기 (이어하기 카드에서 바꿀 때 — 사이드바 배지가 따라 바뀐다) */
  setMode(id: string, mode: RunMode): SessionRecord | undefined {
    const s = this.saved.get(id) ?? this.drafts.get(id);
    if (!s) return undefined;
    return this.update(s, { mode });
  }

  archive(id: string, archived = true): SessionRecord {
    return this.update(this.mustSaved(id), { archived });
  }

  /** 실행 중이면 지울 수 없다 (0B.29) */
  remove(id: string): void {
    if (this.drafts.delete(id)) return;
    const s = this.mustSaved(id);
    if (s.status === 'running')
      throw new SessionError('running', '실행 중인 세션은 지울 수 없어요. 먼저 멈춰 주세요');
    this.saved.delete(id);
    if (!this.memory) {
      rmSync(join(this.dir, id), { recursive: true, force: true });
      this.writeIndex();
    }
    this.announce(SESSION_REMOVED, { id });
  }

  // ── 0B.5 옛 세션 가져오기 ──────────────────────────────────
  /**
   * 이벤트 로그에만 있던 옛 세션을 등록부로 옮긴다 (createSession 사용, id 유지).
   * cwd를 경로 비교기로 프로젝트에 연결하고(이것만 경로 추정), 못 찾으면 projectId null = "프로젝트 없음".
   */
  importLegacy(log: {
    sessions(): string[];
    query(q: { sessionId: string; limit?: number }): LogRecord[];
  }): number {
    let n = 0;
    for (const sid of log.sessions()) {
      if (this.get(sid)) continue;
      const events = log.query({ sessionId: sid, limit: 200 });
      if (!events.length || events.every((e) => e.type === SESSION_REGISTERED)) continue;
      const created = events.find((e) => e.type === 'session_created');
      const cwd = events.map((e) => e.cwd ?? e.workspace).find((v): v is string => typeof v === 'string');
      const project = cwd ? this.projects?.findContaining(cwd) : undefined;
      const prompt = typeof created?.prompt === 'string' ? created.prompt : '';
      const ended = events.some((e) => e.type === 'session_end' || e.type === 'turn_end');
      this.createSession({
        id: sid,
        origin: 'import',
        projectId: project?.id ?? null,
        cwd: cwd ?? '',
        status: ended ? 'done' : 'paused',
        createdAt: events[0]!.ts,
        ...(typeof created?.agent === 'string' ? { agent: created.agent } : {}),
        ...(typeof created?.icon === 'string' ? { agentIcon: created.icon } : {}),
        title: prompt ? titleFromMessage(prompt) : sid,
      });
      n++;
    }
    return n;
  }
}

function atomicWrite(file: string, body: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, file);
}
