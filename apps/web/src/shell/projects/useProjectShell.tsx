import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client.js';
import type { RecentProject } from '../../composer/PlusMenu.js';
import type { EngineOption } from '../../composer/types.js';
import type { NavTarget, Workspace } from '../types.js';
import type { ProjectInfo, ProjectsApi, ProjectView, RootSuggestion, SessionRecordView } from './api.js';
import { ConfirmCard } from './ConfirmCard.js';
import { EmptySession, type RecentAgent } from './EmptySession.js';
import { ProjectSettings } from './ProjectSettings.js';
import { ProjectSidebar, type ProjectAction, type SessionAction } from './ProjectSidebar.js';
import { RootSuggestCard, WhereToWork } from './WhereToWork.js';

/**
 * T-101 0-2 프로젝트·새 세션 화면 상태 (App이 쓰는 한 덩어리)
 * - 서버에 /api/projects가 있으면 켜진다(enabled). 없으면 App은 예전 사이드바를 그대로 쓴다.
 * - 0B.31 지금 고른 프로젝트 하나(currentId)를 사이드바·상단 바(onWorkspace)·+ 메뉴(plusMenu)가 같이 쓴다.
 * - 0B.32 onProjectOpen: 프로젝트를 열 때마다 부른다(2번 "이어서 할 작업" 카드가 여기에 붙는다).
 * - 0B.37 사이드바는 서버 이벤트(session_registered/updated/removed)로 바로 갱신된다.
 */

export type ProjectOpenHook = (p: ProjectView) => void;

export interface UseProjectShellOptions {
  api: ProjectsApi | undefined;
  /** 서버 이벤트 (WebSocket) */
  events: readonly unknown[];
  /** 상단 바 프로젝트 (0B.31) */
  onWorkspace?: (w: Workspace | undefined) => void;
  /** 0B.32 프로젝트 클릭 훅 */
  onProjectOpen?: ProjectOpenHook;
  engines?: EngineOption[];
  agents?: { command: string; name: string; icon?: string }[];
  /** 0B.29 [이어하기] — 2번이 연결하면 넘긴다 (없으면 메뉴에서 숨김) */
  onResume?: (s: SessionRecordView) => void;
  /** 키보드 단축키를 받을 곳 (기본 window) */
  keyTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

type Overlay =
  | { kind: 'where' }
  | { kind: 'suggest'; s: RootSuggestion; then: Pending }
  | { kind: 'settings'; id: string; info?: ProjectInfo }
  | { kind: 'relink-confirm'; id: string; path: string; message: string };

/** 폴더를 고른 뒤 할 일 */
type Pending = 'add' | 'add-and-new' | 'plus';

const message = (err: unknown) => {
  const body = err instanceof ApiError ? (err.body as { message?: string } | undefined) : undefined;
  return body?.message ?? (err instanceof Error ? err.message : String(err));
};

const toWorkspace = (p: ProjectView, info?: ProjectInfo): Workspace => ({
  name: p.name,
  path: p.rootPath,
  ...(p.branch ? { branch: p.branch } : {}),
  ...(info ? { hasAgentsMd: info.hasAgentsMd, hasClaudeMd: info.hasClaudeMd } : {}),
});

export function useProjectShell(o: UseProjectShellOptions) {
  const { api } = o;
  const [enabled, setEnabled] = useState(false);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [currentId, setCurrentId] = useState<string>();
  const [sessions, setSessions] = useState<SessionRecordView[]>([]);
  const [draft, setDraft] = useState<SessionRecordView>();
  const [activeId, setActiveId] = useState<string>();
  const [overlay, setOverlay] = useState<Overlay>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [fill, setFill] = useState<{ text: string; seq: number }>();
  const [pin, setPin] = useState<{ command: string; seq: number }>();
  const [focusSeq, setFocusSeq] = useState(0);
  const [pickerSeq, setPickerSeq] = useState(0);
  const seq = useRef(100);
  const openHooks = useRef(new Set<ProjectOpenHook>());
  const optsRef = useRef(o);
  optsRef.current = o;

  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const current = currentId ? byId.get(currentId) : undefined;

  const refresh = useCallback(async () => {
    if (!api) return;
    const [l, s] = await Promise.all([api.list(), api.sessions()]);
    setProjects(l.projects);
    setCurrentId(l.currentId);
    setSessions(s.sessions);
    return l;
  }, [api]);

  // 켜기: /api/projects가 있으면
  useEffect(() => {
    if (!api) return;
    let stop = false;
    refresh()
      .then((l) => {
        if (stop || !l) return;
        setEnabled(true);
        const p = l.currentId ? l.projects.find((x) => x.id === l.currentId) : undefined;
        if (p) optsRef.current.onWorkspace?.(toWorkspace(p));
      })
      .catch(() => !stop && setEnabled(false));
    return () => {
      stop = true;
    };
  }, [api, refresh]);

  // 0B.37 서버 이벤트로 사이드바 갱신
  const seen = useRef(0);
  useEffect(() => {
    const list = o.events;
    if (list.length < seen.current) seen.current = 0;
    const fresh = list.slice(seen.current);
    seen.current = list.length;
    for (const e of fresh) {
      const r = e as { type?: string; session?: SessionRecordView; sessionId?: string };
      if ((r.type === 'session_registered' || r.type === 'session_updated') && r.session) {
        const s = r.session;
        setSessions((xs) => [s, ...xs.filter((x) => x.id !== s.id)]);
      } else if (r.type === 'session_removed' && r.sessionId) {
        const id = r.sessionId;
        setSessions((xs) => xs.filter((x) => x.id !== id));
      }
    }
  }, [o.events]);

  /** 0B.12 초안을 두고 다른 곳으로 가면 초안을 지운다 */
  const leaveDraft = useCallback(
    (nextId?: string) => {
      if (!api || !draft || draft.id === nextId) return;
      void api.leave(draft.id).catch(() => {});
      setDraft(undefined);
    },
    [api, draft],
  );

  const openProject = useCallback(
    async (id: string) => {
      if (!api) return;
      const p = byId.get(id) ?? (await api.list()).projects.find((x) => x.id === id);
      if (!p) return;
      setCurrentId(id);
      void api.setCurrent(id).catch(() => {});
      optsRef.current.onWorkspace?.(toWorkspace(p));
      void api
        .info(id)
        .then((info) => optsRef.current.onWorkspace?.(toWorkspace(p, info)))
        .catch(() => {});
      optsRef.current.onProjectOpen?.(p);
      for (const fn of openHooks.current) fn(p);
      return p;
    },
    [api, byId],
  );

  /** 0B.14 / 0B.17 새 초안 세션 + 입력창 포커스 */
  const newSessionIn = useCallback(
    async (projectId: string, note?: string) => {
      if (!api) return;
      try {
        leaveDraft();
        if (projectId !== currentId) await openProject(projectId);
        const d = await api.createDraft(projectId);
        setDraft(d);
        setActiveId(d.id);
        setOverlay(undefined);
        setNotice(note);
        setError(undefined);
        setFocusSeq((x) => x + 1);
      } catch (err) {
        setError(message(err));
      }
    },
    [api, currentId, leaveDraft, openProject],
  );

  /** 0B.14 / 0B.15 [+ 새 세션] 본체 */
  const newSession = useCallback(() => {
    if (current && !current.missing) void newSessionIn(current.id);
    else setOverlay({ kind: 'where' });
  }, [current, newSessionIn]);

  const afterAdd = useCallback(
    async (path: string, then: Pending) => {
      if (!api) return;
      try {
        const r = await api.add(path);
        await refresh();
        if (then === 'plus') await selectRef.current?.(r.project.id, true);
        else await openProject(r.project.id);
        if (then === 'add-and-new') await newSessionIn(r.project.id);
        else setOverlay(undefined);
        setError(undefined);
      } catch (err) {
        setError(message(err));
      }
    },
    [api, refresh, openProject, newSessionIn],
  );

  /** [폴더 열기] → 대화상자 → (0B.6 맨 위 폴더 추천) → 등록(0B.7 중복이면 기존 것) */
  const openFolder = useCallback(
    async (then: Pending = 'add-and-new') => {
      if (!api) return;
      let r;
      try {
        r = await api.pickFolder(current?.rootPath);
      } catch (err) {
        setError(message(err));
        return;
      }
      if (r.cancelled) return;
      try {
        const s = await api.suggestRoot(r.path);
        if (s.suggest) {
          setOverlay({ kind: 'suggest', s, then });
          return;
        }
        await afterAdd(s.path, then);
      } catch (err) {
        setError(message(err));
      }
    },
    [api, current, afterAdd],
  );

  const pickPath = useCallback(
    async (initial?: string) => {
      if (!api) return undefined;
      const r = await api.pickFolder(initial).catch(() => ({ cancelled: true }) as const);
      return r.cancelled ? undefined : r.path;
    },
    [api],
  );

  /** 0B.8 [다시 연결]: 새 폴더 → 표식 id 확인 → 기록 그대로 */
  const relink = useCallback(
    async (id: string, path?: string, force = false) => {
      if (!api) return;
      const target = path ?? (await pickPath());
      if (!target) return;
      try {
        await api.relink(id, target, force);
        await refresh();
        setOverlay(undefined);
        setError(undefined);
      } catch (err) {
        const code =
          err instanceof ApiError ? (err.body as { error?: string } | undefined)?.error : undefined;
        if (code === 'no_marker')
          setOverlay({ kind: 'relink-confirm', id, path: target, message: message(err) });
        else setError(message(err));
      }
    },
    [api, pickPath, refresh],
  );

  const scratch = useCallback(async () => {
    if (!api) return;
    try {
      const { project } = await api.scratch();
      await refresh();
      await newSessionIn(project.id);
    } catch (err) {
      setError(message(err));
    }
  }, [api, refresh, newSessionIn]);

  /** 사이드바·+ 메뉴에서 프로젝트를 고름 (0B.31). 0B.13 대화가 있는 세션이면 그 폴더에서 새 초안 */
  const selectProject = useCallback(
    async (id: string, fromPlus = false) => {
      if (!api) return;
      if (fromPlus && activeId) {
        if (draft && draft.id === activeId) {
          const r = await api.changeProject(draft.id, id).catch((err: unknown) => {
            setError(message(err));
            return undefined;
          });
          if (r) setDraft(r.session);
          await openProject(id);
          return;
        }
        const active = sessions.find((s) => s.id === activeId);
        if (active && active.projectId !== id) {
          await newSessionIn(id, '그 폴더에서 새 세션을 열게요');
          return;
        }
      }
      await openProject(id);
    },
    [api, activeId, draft, sessions, openProject, newSessionIn],
  );

  const selectRef = useRef<typeof selectProject | undefined>(undefined);
  selectRef.current = selectProject;

  const selectSession = useCallback(
    (id: string) => {
      leaveDraft(id);
      setActiveId(id);
      setOverlay(undefined);
      setNotice(undefined);
    },
    [leaveDraft],
  );

  /** 입력창 전송을 먼저 본다. 처리했으면 true (App은 더 하지 않는다) */
  const handleSend = useCallback(
    (p: { text: string; agent?: string }): boolean => {
      if (!enabled || !api) return false;
      // 0B.21 입력창 /new
      if (!p.agent && /^\/new\s*$/i.test(p.text)) {
        newSession();
        return true;
      }
      // 0B.12 초안의 첫 메시지 → 저장·사이드바 등록
      if (draft && draft.id === activeId && !p.agent) {
        const d = draft;
        setDraft(undefined);
        setNotice(undefined);
        void api
          .commit(d.id, p.text)
          .then((s) => setSessions((xs) => [s, ...xs.filter((x) => x.id !== s.id)]))
          .catch((err: unknown) => setError(message(err)));
        return true;
      }
      // 에이전트 칩으로 보내면 디스패치가 새 세션을 만든다 → 남은 초안은 지운다
      if (draft && p.agent) leaveDraft();
      return false;
    },
    [enabled, api, draft, activeId, newSession, leaveDraft],
  );

  // 0B.21 Ctrl+N / Ctrl+Shift+N
  useEffect(() => {
    if (!enabled) return;
    const target = o.keyTarget ?? window;
    const onKey = (ev: Event) => {
      const e = ev as KeyboardEvent;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'n') return;
      e.preventDefault();
      if (e.shiftKey) setPickerSeq((x) => x + 1);
      else newSession();
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [enabled, newSession, o.keyTarget]);

  const projectAction = useCallback(
    async (p: ProjectView, a: ProjectAction) => {
      if (!api) return;
      try {
        switch (a.type) {
          case 'new':
            return void (await newSessionIn(p.id));
          case 'rename':
            await api.patch(p.id, { name: a.name });
            break;
          case 'pin':
            await api.patch(p.id, { pinned: a.pinned });
            break;
          case 'reveal':
            await api.reveal(p.id);
            return;
          case 'remove':
            await api.remove(p.id);
            if (currentId === p.id) {
              setCurrentId(undefined);
              optsRef.current.onWorkspace?.(undefined);
            }
            break;
          case 'relink':
            return void (await relink(p.id));
          case 'move': {
            const dest = await pickPath();
            if (!dest) return;
            await api.move(p.id, dest);
            break;
          }
          case 'settings': {
            setOverlay({ kind: 'settings', id: p.id });
            const info = await api.info(p.id).catch(() => undefined);
            setOverlay((cur) =>
              cur?.kind === 'settings' && cur.id === p.id ? { ...cur, ...(info ? { info } : {}) } : cur,
            );
            return;
          }
        }
        await refresh();
        setError(undefined);
      } catch (err) {
        setError(message(err));
      }
    },
    [api, currentId, newSessionIn, relink, pickPath, refresh],
  );

  const sessionAction = useCallback(
    async (s: SessionRecordView, a: SessionAction) => {
      if (!api) return;
      try {
        if (a.type === 'resume') return optsRef.current.onResume?.(s);
        if (a.type === 'delete') {
          await api.removeSession(s.id);
          setSessions((xs) => xs.filter((x) => x.id !== s.id));
          return;
        }
        const next = await api.patchSession(
          s.id,
          a.type === 'rename' ? { title: a.title } : { archived: true },
        );
        setSessions((xs) => xs.map((x) => (x.id === next.id ? next : x)));
        setError(undefined);
      } catch (err) {
        setError(message(err));
      }
    },
    [api],
  );

  const reorder = useCallback(
    async (ids: string[]) => {
      if (!api) return;
      setProjects((ps) =>
        ids.map((id, i) => ({ ...byId.get(id)!, order: i })).concat(ps.filter((p) => !ids.includes(p.id))),
      );
      try {
        setProjects((await api.order(ids)).projects);
      } catch (err) {
        setError(message(err));
      }
    },
    [api, byId],
  );

  const archiveMany = useCallback(
    async (ids: string[]) => {
      if (!api) return;
      const done = await Promise.all(
        ids.map((id) => api.patchSession(id, { archived: true }).catch(() => undefined)),
      );
      setSessions((xs) => xs.map((x) => done.find((d) => d?.id === x.id) ?? x));
    },
    [api],
  );

  /** 0B.32 바깥에서 프로젝트 열기 훅 걸기 (해제 함수 반환) */
  const onProjectOpen = useCallback((fn: ProjectOpenHook) => {
    openHooks.current.add(fn);
    return () => void openHooks.current.delete(fn);
  }, []);

  const recentAgents = useMemo<RecentAgent[]>(() => {
    const list = o.agents ?? [];
    const out: RecentAgent[] = [];
    for (const s of sessions) {
      if (!s.agent) continue;
      const a = list.find((x) => x.name === s.agent || x.command === s.agent || x.command === `/${s.agent}`);
      const command = a?.command ?? (s.agent.startsWith('/') ? s.agent : `/${s.agent}`);
      if (out.some((x) => x.command === command)) continue;
      out.push({
        command,
        name: a?.name ?? s.agent,
        ...((a?.icon ?? s.agentIcon) ? { icon: a?.icon ?? s.agentIcon } : {}),
      });
    }
    for (const a of list) if (!out.some((x) => x.command === a.command)) out.push(a);
    return out.slice(0, 3);
  }, [sessions, o.agents]);

  const renderSidebar = (nav: {
    onNavigate?: (to: NavTarget) => void;
    needsApproval?: Record<string, number>;
  }) => (
    <ProjectSidebar
      projects={projects}
      sessions={sessions}
      {...(currentId ? { currentProjectId: currentId } : {})}
      {...(activeId ? { activeSessionId: activeId } : {})}
      {...(nav.needsApproval ? { needsApproval: nav.needsApproval } : {})}
      onNewSession={newSession}
      onNewSessionIn={(id) => void newSessionIn(id)}
      onOpenFolder={() => void openFolder('add')}
      onSelectProject={(id) => void selectProject(id)}
      onSelectSession={selectSession}
      onProjectAction={(p, a) => void projectAction(p, a)}
      onSessionAction={(s, a) => void sessionAction(s, a)}
      onReorder={(ids) => void reorder(ids)}
      onArchiveMany={(ids) => void archiveMany(ids)}
      {...(nav.onNavigate ? { onNavigate: nav.onNavigate } : {})}
      canResume={!!o.onResume}
      pickerSeq={pickerSeq}
    />
  );

  const settingsProject = overlay?.kind === 'settings' ? byId.get(overlay.id) : undefined;
  let main: ReactNode = null;
  if (overlay?.kind === 'where')
    main = (
      <WhereToWork
        recent={projects}
        onOpenFolder={() => void openFolder('add-and-new')}
        onPickProject={(id) => void newSessionIn(id)}
        onScratch={() => void scratch()}
        onCancel={() => setOverlay(undefined)}
      />
    );
  else if (overlay?.kind === 'suggest')
    main = (
      <RootSuggestCard
        s={overlay.s}
        onUseTop={() => void afterAdd(overlay.s.gitRoot ?? overlay.s.path, overlay.then)}
        onKeep={() => void afterAdd(overlay.s.path, overlay.then)}
      />
    );
  else if (overlay?.kind === 'relink-confirm')
    main = (
      <ConfirmCard
        title="이 폴더로 연결할까요?"
        body={overlay.message}
        confirmLabel="그래도 연결"
        onConfirm={() => void relink(overlay.id, overlay.path, true)}
        onCancel={() => setOverlay(undefined)}
      />
    );
  else if (settingsProject && overlay?.kind === 'settings')
    main = (
      <ProjectSettings
        key={settingsProject.id}
        project={settingsProject}
        {...(overlay.info ? { info: overlay.info } : {})}
        engines={o.engines ?? []}
        agents={o.agents ?? []}
        onSave={async (v) => {
          if (!api) return;
          try {
            await api.patch(settingsProject.id, { name: v.name, defaults: v.defaults });
            await refresh();
          } catch (err) {
            setError(message(err));
          }
        }}
        onRelink={() => void relink(settingsProject.id)}
        onClose={() => setOverlay(undefined)}
      />
    );
  else if (draft && draft.id === activeId)
    main = (
      <EmptySession
        projectName={byId.get(draft.projectId ?? '')?.name ?? '이 폴더'}
        recentAgents={recentAgents}
        onExample={(text) => {
          setFill({ text, seq: ++seq.current });
          setFocusSeq((x) => x + 1);
        }}
        onAgent={(command) => {
          setPin({ command, seq: ++seq.current });
          setFocusSeq((x) => x + 1);
        }}
        {...(notice ? { notice } : {})}
      />
    );

  const plusRecent: RecentProject[] = projects
    .filter((p) => !p.missing)
    .map((p) => ({
      name: p.name,
      path: p.rootPath,
      pinned: p.pinned,
      ...(p.branch ? { branch: p.branch } : {}),
    }));

  return {
    enabled,
    projects,
    sessions,
    current,
    currentId,
    activeId,
    draft,
    error,
    renderSidebar,
    /** 채팅 영역 위에 놓는 화면 (어디서 작업할까요 / 빈 세션 / 프로젝트 설정) — 없으면 null */
    main,
    composer: { fill, pin, focusSeq },
    plusMenu: {
      recent: plusRecent,
      onOpenFolder: () => void openFolder('plus'),
      onPickRecent: (r: RecentProject) => {
        const p = projects.find((x) => x.rootPath === r.path);
        if (p) void selectProject(p.id, true);
      },
      onTogglePin: (r: RecentProject) => {
        const p = projects.find((x) => x.rootPath === r.path);
        if (p) void projectAction(p, { type: 'pin', pinned: !p.pinned });
      },
    },
    handleSend,
    newSession,
    newSessionIn,
    selectProject,
    onProjectOpen,
    refresh,
  };
}
