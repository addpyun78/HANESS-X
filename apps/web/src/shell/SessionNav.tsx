import { useMemo, useState } from 'react';
import {
  ALL,
  EMPTY_FILTER,
  filterOptions,
  filterSessions,
  groupByProject,
  type SessionFilter,
} from './filter.js';
import { Sidebar, type SidebarProps } from './Sidebar.js';
import { SESSION_STATUS_LABEL, type SessionStatus, type SessionSummary } from './types.js';

export interface SessionNavProps extends Omit<SidebarProps, 'groups' | 'filters'> {
  sessions: SessionSummary[];
}

/** 사이드바 + 세션 필터(상태·프로젝트·엔진) + 프로젝트별 그룹 */
export function SessionNav({ sessions, ...rest }: SessionNavProps) {
  const [f, setF] = useState<SessionFilter>(EMPTY_FILTER);
  const opts = useMemo(() => filterOptions(sessions), [sessions]);
  const groups = useMemo(() => groupByProject(filterSessions(sessions, f)), [sessions, f]);
  const filters = (
    <div className="hx-sidebar__filters" role="group" aria-label="세션 필터">
      <select
        aria-label="상태"
        value={f.status}
        onChange={(e) => setF({ ...f, status: e.target.value as SessionStatus })}
      >
        <option value={ALL}>상태</option>
        {(Object.keys(SESSION_STATUS_LABEL) as SessionStatus[]).map((s) => (
          <option key={s} value={s}>
            {SESSION_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <select
        aria-label="프로젝트"
        value={f.project}
        onChange={(e) => setF({ ...f, project: e.target.value })}
      >
        <option value={ALL}>프로젝트</option>
        {opts.projects.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <select aria-label="엔진" value={f.engine} onChange={(e) => setF({ ...f, engine: e.target.value })}>
        <option value={ALL}>엔진</option>
        {opts.engines.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
    </div>
  );
  return <Sidebar {...rest} groups={groups} filters={filters} />;
}
