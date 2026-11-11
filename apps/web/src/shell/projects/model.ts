import type { ProjectView, SessionRecordView, SessionState } from './api.js';

/** T-101 0-2 사이드바 화면 모델 (순수 함수 — 묶기·정렬·필터·완료 접기) */

export const NO_PROJECT = '__none__';
export const NO_PROJECT_LABEL = '프로젝트 없음';

/** 0B.24 상태 아이콘 */
export const STATE_ICON: Record<SessionState, { icon: string; label: string }> = {
  running: { icon: '●', label: '진행 중' },
  'needs-approval': { icon: '✋', label: '확인 필요' },
  paused: { icon: '⏸', label: '멈춤' },
  done: { icon: '✓', label: '완료' },
  idle: { icon: '○', label: '대기' },
  error: { icon: '!', label: '문제 있음' },
};

/** 0B.24 모드 배지 (3번 실행 모드 이후 세션에 mode가 생기면 표시) */
export const MODE_LABEL: Record<string, string> = { plan: '계획', normal: '일반', auto: '오토' };
export const modeLabel = (m: string | undefined) => (m ? (MODE_LABEL[m] ?? m) : undefined);

export type GroupMode = 'project' | 'status' | 'date' | 'none';
export const GROUP_LABEL: Record<GroupMode, string> = {
  project: '프로젝트',
  status: '상태',
  date: '날짜',
  none: '묶지 않음',
};

export type SortMode = 'recent' | 'name' | 'manual';
export const SORT_LABEL: Record<SortMode, string> = {
  recent: '최근 활동',
  name: '이름순',
  manual: '내가 정한 순서',
};

export interface SessionFilter {
  status: SessionState | 'all';
  engine: string;
  agent: string;
  query: string;
}
export const EMPTY_FILTER: SessionFilter = { status: 'all', engine: 'all', agent: 'all', query: '' };

/** 0B.30 완료된 지 30일 지나면 보관 제안 */
export const ARCHIVE_SUGGEST_DAYS = 30;

export interface SessionGroupView {
  key: string;
  label: string;
  project?: ProjectView;
  /** 진행 중·확인 필요·멈춤·대기 (보관 안 된 것) */
  active: SessionRecordView[];
  /** 0B.30 "완료됨 (n)"으로 접어 두는 것 */
  done: SessionRecordView[];
}

/** 세션 상태 (확인 필요 카드가 있으면 ✋) */
export function effectiveState(s: SessionRecordView, needsApproval?: number): SessionState {
  return needsApproval ? 'needs-approval' : s.status;
}

/** 0B.27 필터: 상태·엔진·에이전트 + 찾기(세션 제목·프로젝트 이름) */
export function filterSessions(
  list: SessionRecordView[],
  f: SessionFilter,
  projectName: (id: string | null) => string,
): SessionRecordView[] {
  const q = f.query.trim().toLowerCase();
  return list.filter(
    (s) =>
      !s.archived &&
      (f.status === 'all' || s.status === f.status) &&
      (f.engine === 'all' || s.engine === f.engine) &&
      (f.agent === 'all' || s.agent === f.agent) &&
      (!q || s.title.toLowerCase().includes(q) || projectName(s.projectId).toLowerCase().includes(q)),
  );
}

export function filterOptions(list: SessionRecordView[]) {
  const uniq = (xs: (string | undefined)[]) =>
    [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  return { engines: uniq(list.map((s) => s.engine)), agents: uniq(list.map((s) => s.agent)) };
}

const byActivity = (a: SessionRecordView, b: SessionRecordView) =>
  b.lastActivityAt.localeCompare(a.lastActivityAt);

function split(list: SessionRecordView[]): Pick<SessionGroupView, 'active' | 'done'> {
  const sorted = [...list].sort(byActivity);
  return {
    active: sorted.filter((s) => s.status !== 'done'),
    done: sorted.filter((s) => s.status === 'done'),
  };
}

/** 0B.26 프로젝트 순서: 고정은 항상 맨 위, 그다음 최근 활동 / 이름순 / 내가 정한 순서 */
export function sortProjects(
  projects: ProjectView[],
  sort: SortMode,
  sessions: SessionRecordView[],
): ProjectView[] {
  const last = new Map<string, string>();
  for (const s of sessions) {
    if (!s.projectId) continue;
    const cur = last.get(s.projectId);
    if (!cur || s.lastActivityAt > cur) last.set(s.projectId, s.lastActivityAt);
  }
  const activity = (p: ProjectView) => {
    const s = last.get(p.id);
    return s && s > p.lastOpenedAt ? s : p.lastOpenedAt;
  };
  const cmp = (a: ProjectView, b: ProjectView) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : sort === 'manual'
        ? a.order - b.order
        : activity(b).localeCompare(activity(a));
  return [...projects].sort((a, b) => Number(b.pinned) - Number(a.pinned) || cmp(a, b));
}

function dayKey(iso: string, now: Date): { key: string; label: string } {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days <= 0) return { key: '0', label: '오늘' };
  if (days === 1) return { key: '1', label: '어제' };
  if (days < 7) return { key: '2', label: '지난 7일' };
  if (days < 30) return { key: '3', label: '지난 30일' };
  return { key: '4', label: '더 이전' };
}

const STATUS_ORDER: SessionState[] = ['needs-approval', 'running', 'paused', 'idle', 'error', 'done'];

/** 0B.25 묶기: 프로젝트(기본) / 상태 / 날짜 / 없음 */
export function groupSessions(
  sessions: SessionRecordView[],
  projects: ProjectView[],
  mode: GroupMode,
  o: { sort?: SortMode; now?: Date; noProjectCount?: boolean } = {},
): SessionGroupView[] {
  const now = o.now ?? new Date();
  if (mode === 'project') {
    const ordered = sortProjects(projects, o.sort ?? 'recent', sessions);
    const groups: SessionGroupView[] = ordered.map((p) => ({
      key: p.id,
      label: p.name,
      project: p,
      ...split(sessions.filter((s) => s.projectId === p.id)),
    }));
    const known = new Set(projects.map((p) => p.id));
    const orphan = sessions.filter((s) => !s.projectId || !known.has(s.projectId));
    if (orphan.length) groups.push({ key: NO_PROJECT, label: NO_PROJECT_LABEL, ...split(orphan) });
    return groups;
  }
  if (mode === 'status') {
    return STATUS_ORDER.flatMap((st) => {
      const list = sessions.filter((s) => s.status === st).sort(byActivity);
      if (!list.length) return [];
      return [
        {
          key: st,
          label: STATE_ICON[st].label,
          active: st === 'done' ? [] : list,
          done: st === 'done' ? list : [],
        },
      ];
    });
  }
  if (mode === 'date') {
    const by = new Map<string, SessionGroupView>();
    for (const s of [...sessions].sort(byActivity)) {
      const d = dayKey(s.lastActivityAt, now);
      const g = by.get(d.key) ?? { key: d.key, label: d.label, active: [], done: [] };
      g.active.push(s);
      by.set(d.key, g);
    }
    return [...by.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
  return [{ key: 'all', label: '모든 세션', active: [...sessions].sort(byActivity), done: [] }];
}

/** 0B.30 완료된 지 30일 지난 세션 (보관 제안만, 자동 삭제 금지) */
export function archiveSuggestions(sessions: SessionRecordView[], now = new Date()): SessionRecordView[] {
  const limit = now.getTime() - ARCHIVE_SUGGEST_DAYS * 86_400_000;
  return sessions.filter(
    (s) => s.status === 'done' && !s.archived && new Date(s.doneAt ?? s.lastActivityAt).getTime() < limit,
  );
}

/** 0B.23 진행 중 세션 수 배지 */
export const runningCount = (g: SessionGroupView) =>
  g.active.filter((s) => s.status === 'running' || s.status === 'needs-approval').length;

/** 0B.24 마지막 활동 시각 (쉬운 말) */
export function relativeTime(iso: string, now = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d === 1) return '어제';
  if (d < 30) return `${d}일 전`;
  const t = new Date(iso);
  return `${t.getMonth() + 1}월 ${t.getDate()}일`;
}

/** 끌어 놓기: from을 to 자리로 옮긴 id 순서 */
export function moveId(ids: string[], from: string, to: string): string[] {
  if (from === to) return ids;
  const rest = ids.filter((x) => x !== from);
  const at = rest.indexOf(to);
  const fromIdx = ids.indexOf(from);
  const toIdx = ids.indexOf(to);
  rest.splice(fromIdx < toIdx ? at + 1 : at, 0, from);
  return rest;
}
