import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NAV_ITEMS, type NavTarget } from '../types.js';
import type { ProjectView, SessionRecordView } from './api.js';
import { ConfirmCard } from './ConfirmCard.js';
import {
  archiveSuggestions,
  EMPTY_FILTER,
  effectiveState,
  filterOptions,
  filterSessions,
  GROUP_LABEL,
  groupSessions,
  modeLabel,
  moveId,
  NO_PROJECT_LABEL,
  relativeTime,
  runningCount,
  SORT_LABEL,
  sortProjects,
  STATE_ICON,
  type GroupMode,
  type SessionFilter,
  type SessionGroupView,
  type SortMode,
} from './model.js';
import { loadPrefs, savePrefs, type SidebarPrefs } from './prefs.js';
import './projects.css';

/**
 * T-101 0-2 사이드바 (설계 그림 그대로)
 *   [+ 새 세션 │▾]  / 🔍 세션·프로젝트 찾기 / "프로젝트" 머리글 + [폴더 열기] / 프로젝트 묶음 /
 *   묶기·정렬·필터 / 하단 메뉴(에이전트 만들기 · 플러그인 · 설치 관리 · 설정 …)
 */

export type ProjectAction =
  | { type: 'new' }
  | { type: 'rename'; name: string }
  | { type: 'pin'; pinned: boolean }
  | { type: 'reveal' }
  | { type: 'remove' }
  | { type: 'relink' }
  | { type: 'move' }
  | { type: 'settings' };

export type SessionAction =
  { type: 'rename'; title: string } | { type: 'resume' } | { type: 'archive' } | { type: 'delete' };

export interface ProjectSidebarProps {
  projects: ProjectView[];
  sessions: SessionRecordView[];
  /** 지금 고른 프로젝트 (0B.31 상단 바·+ 메뉴와 같은 값) */
  currentProjectId?: string;
  activeSessionId?: string;
  /** T-100 H.12 확인 필요 카드 수 (세션별) */
  needsApproval?: Record<string, number>;
  /** [+ 새 세션] 본체: 지금 프로젝트에서 (없으면 "어디서 작업할까요?") */
  onNewSession: () => void;
  /** [▾]·[+]: 그 프로젝트에서 새 세션 */
  onNewSessionIn: (projectId: string) => void;
  onOpenFolder: () => void;
  /** 0B.32 프로젝트 클릭 (onProjectOpen 훅이 여기에 걸린다) */
  onSelectProject: (projectId: string) => void;
  onSelectSession: (id: string) => void;
  onProjectAction: (project: ProjectView, a: ProjectAction) => void;
  onSessionAction: (session: SessionRecordView, a: SessionAction) => void;
  /** 0B.26 끌어서 바꾼 순서 저장 */
  onReorder: (ids: string[]) => void;
  /** 0B.30 30일 지난 완료 세션 보관 */
  onArchiveMany?: (ids: string[]) => void;
  onNavigate?: (to: NavTarget) => void;
  /** 0B.29 [이어하기] — 2번(이어하기)이 연결하기 전에는 주지 않는다 → 메뉴에서 숨김 */
  canResume?: boolean;
  now?: Date;
  /** 묶기·정렬 기억 (테스트에서 바꿔 끼움) */
  prefs?: { load: () => SidebarPrefs; save: (p: SidebarPrefs) => void };
  /** [▾] 펼침 상태를 바깥에서 열기 (Ctrl+Shift+N) */
  pickerSeq?: number;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const {
    projects,
    sessions,
    currentProjectId,
    activeSessionId,
    needsApproval = {},
    onNewSession,
    onNewSessionIn,
    onOpenFolder,
    onSelectProject,
    onSelectSession,
    onProjectAction,
    onSessionAction,
    onReorder,
    onArchiveMany,
    onNavigate,
    canResume = false,
    now,
    pickerSeq,
  } = props;
  const store = props.prefs ?? { load: loadPrefs, save: savePrefs };
  const [prefs, setPrefsState] = useState<SidebarPrefs>(() => store.load());
  const setPrefs = (p: Partial<SidebarPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefsState(next);
    store.save(next);
  };
  const [filter, setFilter] = useState<SessionFilter>(EMPTY_FILTER);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openDone, setOpenDone] = useState<ReadonlySet<string>>(() => new Set());
  const [confirm, setConfirm] = useState<{ title: string; body: string; label: string; run: () => void }>();
  const dragging = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (pickerSeq) setPickerOpen(true);
  }, [pickerSeq]);

  const nameOf = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? (m.get(id) ?? NO_PROJECT_LABEL) : NO_PROJECT_LABEL);
  }, [projects]);
  const visible = useMemo(
    () =>
      filterSessions(sessions, filter, nameOf).map((s) =>
        needsApproval[s.id] ? { ...s, status: effectiveState(s, needsApproval[s.id]) } : s,
      ),
    [sessions, filter, nameOf, needsApproval],
  );
  const q = filter.query.trim().toLowerCase();
  const shownProjects = useMemo(
    () =>
      q
        ? projects.filter(
            (p) => p.name.toLowerCase().includes(q) || visible.some((s) => s.projectId === p.id),
          )
        : projects,
    [projects, visible, q],
  );
  const groups = useMemo(
    () => groupSessions(visible, shownProjects, prefs.group, { sort: prefs.sort, ...(now ? { now } : {}) }),
    [visible, shownProjects, prefs.group, prefs.sort, now],
  );
  const opts = useMemo(() => filterOptions(sessions), [sessions]);
  const stale = useMemo(() => archiveSuggestions(sessions, now), [sessions, now]);
  const pickerList = useMemo(() => sortProjects(projects, 'recent', sessions), [projects, sessions]);

  const drop = (target: string) => {
    const from = dragging.current;
    dragging.current = undefined;
    if (!from || from === target) return;
    const ids = groups.filter((g) => g.project).map((g) => g.key);
    onReorder(moveId(ids, from, target));
    if (prefs.sort !== 'manual') setPrefs({ sort: 'manual' });
  };

  return (
    <nav className="hx-sidebar hx-psidebar" aria-label="사이드바">
      <div className="hx-newsession" role="group" aria-label="새 세션">
        <button
          type="button"
          className="hx-newsession__main"
          title="지금 프로젝트에서 새 세션 (Ctrl+N)"
          onClick={onNewSession}
        >
          + 새 세션
        </button>
        <button
          type="button"
          className="hx-newsession__more"
          aria-label="프로젝트 골라서 새 세션"
          title="프로젝트 골라서 새 세션 (Ctrl+Shift+N)"
          aria-expanded={pickerOpen}
          aria-haspopup="menu"
          onClick={() => setPickerOpen((x) => !x)}
        >
          ▾
        </button>
        {pickerOpen && (
          <ul className="hx-menu hx-newsession__menu" role="menu" aria-label="어느 프로젝트에서 시작할까요">
            {pickerList.map((p) => (
              <li key={p.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={p.missing}
                  onClick={() => {
                    setPickerOpen(false);
                    onNewSessionIn(p.id);
                  }}
                >
                  {p.pinned ? '📌 ' : ''}📁 {p.name}
                </button>
              </li>
            ))}
            <li role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPickerOpen(false);
                  onOpenFolder();
                }}
              >
                폴더 열기…
              </button>
            </li>
          </ul>
        )}
      </div>

      <input
        type="search"
        className="hx-psidebar__search"
        aria-label="세션·프로젝트 찾기"
        placeholder="🔍 세션·프로젝트 찾기"
        value={filter.query}
        onChange={(e) => setFilter({ ...filter, query: e.target.value })}
      />

      <div className="hx-psidebar__head">
        <h2>프로젝트</h2>
        <button type="button" onClick={onOpenFolder}>
          폴더 열기
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="hx-sidebar__empty">
          {projects.length
            ? '찾는 세션이 없어요'
            : '아직 프로젝트가 없어요. [폴더 열기]로 작업할 폴더를 골라 주세요'}
        </p>
      ) : (
        <ul className="hx-psidebar__groups" aria-label="프로젝트 목록">
          {groups.map((g) => (
            <GroupView
              key={g.key}
              g={g}
              mode={prefs.group}
              collapsed={prefs.collapsed.includes(g.key)}
              onToggle={() =>
                setPrefs({
                  collapsed: prefs.collapsed.includes(g.key)
                    ? prefs.collapsed.filter((x) => x !== g.key)
                    : [...prefs.collapsed, g.key],
                })
              }
              selected={g.key === currentProjectId}
              activeSessionId={activeSessionId}
              doneOpen={openDone.has(g.key)}
              onToggleDone={() =>
                setOpenDone((s) => {
                  const n = new Set(s);
                  if (n.has(g.key)) n.delete(g.key);
                  else n.add(g.key);
                  return n;
                })
              }
              onSelectProject={onSelectProject}
              onSelectSession={onSelectSession}
              onNewSessionIn={onNewSessionIn}
              onProjectAction={(p, a) => {
                if (a.type === 'remove')
                  setConfirm({
                    title: `'${p.name}'을(를) 목록에서 뺄까요?`,
                    body: '폴더와 파일은 지우지 않아요. 나중에 [폴더 열기]로 다시 넣을 수 있어요.',
                    label: '목록에서 빼기',
                    run: () => onProjectAction(p, a),
                  });
                else onProjectAction(p, a);
              }}
              onSessionAction={(s, a) => {
                if (a.type === 'delete')
                  setConfirm({
                    title: `'${s.title || '제목 없는 세션'}' 세션을 지울까요?`,
                    body: '이 세션의 대화 기록이 사라져요. 되돌릴 수 없어요.',
                    label: '지우기',
                    run: () => onSessionAction(s, a),
                  });
                else onSessionAction(s, a);
              }}
              canResume={canResume}
              now={now}
              onDragStart={(id) => (dragging.current = id)}
              onDrop={drop}
            />
          ))}
        </ul>
      )}

      {stale.length > 0 && onArchiveMany && (
        <div className="hx-psidebar__archive" role="note">
          완료된 지 30일 지난 세션이 {stale.length}개 있어요. 보관해 둘까요? (지우지 않아요)
          <button type="button" onClick={() => onArchiveMany(stale.map((s) => s.id))}>
            보관하기
          </button>
        </div>
      )}

      <div className="hx-psidebar__controls" role="group" aria-label="묶기와 필터">
        <label>
          묶기
          <select
            aria-label="묶기"
            value={prefs.group}
            onChange={(e) => setPrefs({ group: e.target.value as GroupMode })}
          >
            {(Object.keys(GROUP_LABEL) as GroupMode[]).map((m) => (
              <option key={m} value={m}>
                {GROUP_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label>
          정렬
          <select
            aria-label="정렬"
            value={prefs.sort}
            onChange={(e) => setPrefs({ sort: e.target.value as SortMode })}
          >
            {(Object.keys(SORT_LABEL) as SortMode[]).map((m) => (
              <option key={m} value={m}>
                {SORT_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label>
          필터
          <select
            aria-label="상태 필터"
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value as SessionFilter['status'] })}
          >
            <option value="all">전체</option>
            {(Object.keys(STATE_ICON) as (keyof typeof STATE_ICON)[]).map((st) => (
              <option key={st} value={st}>
                {STATE_ICON[st].label}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label="엔진 필터"
          value={filter.engine}
          onChange={(e) => setFilter({ ...filter, engine: e.target.value })}
        >
          <option value="all">모든 AI</option>
          {opts.engines.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          aria-label="에이전트 필터"
          value={filter.agent}
          onChange={(e) => setFilter({ ...filter, agent: e.target.value })}
        >
          <option value="all">모든 에이전트</option>
          {opts.agents.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>

      <div className="hx-sidebar__nav" role="menu" aria-label="하단 메뉴">
        {NAV_ITEMS.map((n) => (
          <button
            key={n.id}
            type="button"
            role="menuitem"
            className="hx-nav-item"
            onClick={() => onNavigate?.(n.id)}
          >
            <span aria-hidden="true">{n.icon}</span>
            {n.label}
          </button>
        ))}
      </div>

      {confirm && (
        <ConfirmCard
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.label}
          onConfirm={() => {
            confirm.run();
            setConfirm(undefined);
          }}
          onCancel={() => setConfirm(undefined)}
        />
      )}
    </nav>
  );
}

interface GroupViewProps {
  g: SessionGroupView;
  mode: GroupMode;
  collapsed: boolean;
  onToggle: () => void;
  selected: boolean;
  activeSessionId: string | undefined;
  doneOpen: boolean;
  onToggleDone: () => void;
  onSelectProject: (id: string) => void;
  onSelectSession: (id: string) => void;
  onNewSessionIn: (id: string) => void;
  onProjectAction: (p: ProjectView, a: ProjectAction) => void;
  onSessionAction: (s: SessionRecordView, a: SessionAction) => void;
  canResume: boolean;
  now: Date | undefined;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
}

function GroupView(v: GroupViewProps) {
  const { g, collapsed } = v;
  const p = g.project;
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const running = runningCount(g);
  const rows = (list: SessionRecordView[]) =>
    list.map((s) => (
      <SessionRow
        key={s.id}
        s={s}
        active={s.id === v.activeSessionId}
        onSelect={() => v.onSelectSession(s.id)}
        onAction={(a) => v.onSessionAction(s, a)}
        canResume={v.canResume}
        now={v.now}
      />
    ));
  return (
    <li
      className="hx-pgroup"
      data-group={g.key}
      data-missing={p?.missing || undefined}
      draggable={!!p && v.mode === 'project'}
      onDragStart={(e) => {
        if (!p) return;
        e.dataTransfer?.setData('text/plain', p.id);
        v.onDragStart(p.id);
      }}
      onDragOver={(e) => p && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (p) v.onDrop(p.id);
      }}
    >
      <div className="hx-pgroup__row" aria-current={v.selected ? 'true' : undefined}>
        <button
          type="button"
          className="hx-pgroup__toggle"
          aria-expanded={!collapsed}
          aria-label={`${g.label} ${collapsed ? '펼치기' : '접기'}`}
          onClick={v.onToggle}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        {renaming && p ? (
          <RenameInput
            label="프로젝트 새 이름"
            initial={p.name}
            onDone={(name) => {
              setRenaming(false);
              if (name && name !== p.name) v.onProjectAction(p, { type: 'rename', name });
            }}
          />
        ) : (
          <button
            type="button"
            className="hx-pgroup__name"
            onClick={() => (p ? v.onSelectProject(p.id) : v.onToggle())}
          >
            {p?.pinned && (
              <span aria-label="고정됨" className="hx-pgroup__pin">
                📌
              </span>
            )}
            {p && <span aria-hidden="true">📁 </span>}
            {g.label}
          </button>
        )}
        {p?.branch && !p.missing && (
          <span className="hx-pgroup__branch" aria-label={`브랜치 ${p.branch}`}>
            {p.branch}
          </span>
        )}
        {running > 0 && (
          <span className="hx-pgroup__running" aria-label={`진행 중 ${running}개`}>
            ●{running}
          </span>
        )}
        {p && (
          <>
            <button
              type="button"
              className="hx-pgroup__new"
              aria-label={`${p.name}에서 새 세션`}
              disabled={p.missing}
              onClick={() => v.onNewSessionIn(p.id)}
            >
              +
            </button>
            <button
              type="button"
              className="hx-pgroup__more"
              aria-label={`${p.name} 메뉴`}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((x) => !x)}
            >
              …
            </button>
          </>
        )}
        {p?.missing && (
          <span className="hx-pgroup__missing" role="status">
            ⚠ 폴더를 찾을 수 없어요
            <button type="button" onClick={() => v.onProjectAction(p, { type: 'relink' })}>
              다시 연결
            </button>
          </span>
        )}
        {menu && p && (
          <ProjectMenu
            p={p}
            onClose={() => setMenu(false)}
            onRename={() => setRenaming(true)}
            onAction={(a) => v.onProjectAction(p, a)}
            onNew={() => v.onNewSessionIn(p.id)}
          />
        )}
      </div>
      {!collapsed && (
        <ul className="hx-pgroup__sessions" aria-label={`${g.label} 세션`}>
          {rows(g.active)}
          {g.done.length > 0 && (
            <li className="hx-pgroup__done">
              <button type="button" aria-expanded={v.doneOpen} onClick={v.onToggleDone}>
                {v.doneOpen ? '▾' : '▸'} 완료됨 ({g.done.length})
              </button>
              {v.doneOpen && <ul aria-label={`${g.label} 완료된 세션`}>{rows(g.done)}</ul>}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function ProjectMenu({
  p,
  onClose,
  onRename,
  onAction,
  onNew,
}: {
  p: ProjectView;
  onClose: () => void;
  onRename: () => void;
  onAction: (a: ProjectAction) => void;
  onNew: () => void;
}) {
  const item = (label: string, run: () => void, disabled = false) => (
    <li role="none" key={label}>
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={() => {
          onClose();
          run();
        }}
      >
        {label}
      </button>
    </li>
  );
  return (
    <ul className="hx-menu hx-pgroup__menu" role="menu" aria-label={`${p.name} 메뉴`}>
      {item('새 세션', onNew, p.missing)}
      {item('이름 바꾸기', onRename)}
      {item(p.pinned ? '고정 해제' : '고정', () => onAction({ type: 'pin', pinned: !p.pinned }))}
      {item('탐색기에서 열기', () => onAction({ type: 'reveal' }), p.missing)}
      {item('프로젝트 설정', () => onAction({ type: 'settings' }))}
      {item('폴더 다시 연결', () => onAction({ type: 'relink' }))}
      {p.scratch && item('다른 폴더로 옮기기', () => onAction({ type: 'move' }))}
      {item('목록에서 빼기', () => onAction({ type: 'remove' }))}
    </ul>
  );
}

function SessionRow({
  s,
  active,
  onSelect,
  onAction,
  canResume,
  now,
}: {
  s: SessionRecordView;
  active: boolean;
  onSelect: () => void;
  onAction: (a: SessionAction) => void;
  canResume: boolean;
  now: Date | undefined;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const st = STATE_ICON[s.status];
  const mode = modeLabel(s.mode);
  const title = s.title || '제목 없는 세션';
  const running = s.status === 'running';
  const item = (label: string, run: () => void, disabled = false, why?: string) => (
    <li role="none" key={label}>
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        title={why}
        aria-description={why}
        onClick={() => {
          setMenu(false);
          run();
        }}
      >
        {label}
      </button>
      {disabled && why && <span className="hx-menu__why">{why}</span>}
    </li>
  );
  return (
    <li className={`hx-srow hx-srow--${s.status}`} data-session-id={s.id}>
      {renaming ? (
        <RenameInput
          label="세션 새 이름"
          initial={s.title}
          onDone={(t) => {
            setRenaming(false);
            if (t && t !== s.title) onAction({ type: 'rename', title: t });
          }}
        />
      ) : (
        <button
          type="button"
          className="hx-srow__main"
          aria-current={active ? 'true' : undefined}
          onClick={onSelect}
        >
          <span className="hx-srow__state" role="img" aria-label={st.label}>
            {st.icon}
          </span>
          <span className="hx-srow__title">{title}</span>
          {s.agentIcon && (
            <span className="hx-srow__agent" role="img" aria-label={`에이전트 ${s.agent ?? ''}`.trim()}>
              {s.agentIcon}
            </span>
          )}
          {mode && (
            <span className="hx-srow__mode" aria-label={`모드 ${mode}`}>
              {mode}
            </span>
          )}
          {s.stageProgress && (
            <small className="hx-srow__stage" aria-label={`진행 ${s.stageProgress}`}>
              {s.stageProgress}
            </small>
          )}
          <time className="hx-srow__time" dateTime={s.lastActivityAt}>
            {relativeTime(s.lastActivityAt, now)}
          </time>
        </button>
      )}
      <button
        type="button"
        className="hx-srow__more"
        aria-label={`${title} 메뉴`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((x) => !x)}
      >
        …
      </button>
      {menu && (
        <ul className="hx-menu hx-srow__menu" role="menu" aria-label={`${title} 메뉴`}>
          {item('이름 바꾸기', () => setRenaming(true))}
          {canResume && item('이어하기', () => onAction({ type: 'resume' }))}
          {item('보관', () => onAction({ type: 'archive' }))}
          {item(
            '삭제',
            () => onAction({ type: 'delete' }),
            running,
            running ? '실행 중에는 지울 수 없어요. 먼저 멈춰 주세요' : undefined,
          )}
        </ul>
      )}
    </li>
  );
}

function RenameInput({
  label,
  initial,
  onDone,
}: {
  label: string;
  initial: string;
  onDone: (v: string | undefined) => void;
}): ReactNode {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (x: string | undefined) => {
    if (done.current) return;
    done.current = true;
    onDone(x);
  };
  return (
    <input
      className="hx-rename"
      aria-label={label}
      value={v}
      autoFocus
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) finish(v.trim() || undefined);
        if (e.key === 'Escape') finish(undefined);
      }}
      onBlur={() => finish(v.trim() || undefined)}
    />
  );
}
