import type { SessionStatus, SessionSummary } from './types.js';
import type { SessionGroup } from './Sidebar.js';

export const ALL = 'all' as const;

export interface SessionFilter {
  status: SessionStatus | typeof ALL;
  project: string;
  engine: string;
}

export const EMPTY_FILTER: SessionFilter = { status: ALL, project: ALL, engine: ALL };

export function filterSessions(list: SessionSummary[], f: SessionFilter): SessionSummary[] {
  return list.filter(
    (s) =>
      (f.status === ALL || s.status === f.status) &&
      (f.project === ALL || s.project === f.project) &&
      (f.engine === ALL || s.engineId === f.engine),
  );
}

/** 프로젝트별 묶기: 묶음 안은 최근 갱신 순, 묶음은 가장 최근 세션 순 */
export function groupByProject(list: SessionSummary[]): SessionGroup[] {
  const by = new Map<string, SessionSummary[]>();
  for (const s of [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const g = by.get(s.project);
    if (g) g.push(s);
    else by.set(s.project, [s]);
  }
  return [...by].map(([project, sessions]) => ({ project, sessions }));
}

export function filterOptions(list: SessionSummary[]) {
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  return { projects: uniq(list.map((s) => s.project)), engines: uniq(list.map((s) => s.engineId)) };
}
