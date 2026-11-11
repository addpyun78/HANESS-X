import type { ReactNode } from 'react';
import { NAV_ITEMS, SESSION_STATUS_LABEL, type NavTarget, type SessionSummary } from './types.js';
import { act, NOT_READY } from '../actions/registry.js';

export interface SessionGroup {
  project: string;
  sessions: SessionSummary[];
}

export interface SidebarProps {
  groups: SessionGroup[];
  activeSessionId?: string;
  onNewSession?: () => void;
  onSelectSession?: (id: string) => void;
  onNavigate?: (to: NavTarget) => void;
  /** 세션 목록 위 필터 줄 */
  filters?: ReactNode;
}

export function Sidebar({
  groups,
  activeSessionId,
  onNewSession,
  onSelectSession,
  onNavigate,
  filters,
}: SidebarProps) {
  const empty = groups.every((g) => g.sessions.length === 0);
  return (
    <nav className="hx-sidebar" aria-label="사이드바">
      <button
        {...act('sidebar.new-session')}
        type="button"
        className="hx-sidebar__new"
        disabled={!onNewSession}
        title={onNewSession ? undefined : NOT_READY}
        onClick={onNewSession}
      >
        + 새 세션
      </button>
      {filters}
      {empty ? (
        <p className="hx-sidebar__empty">세션이 없습니다</p>
      ) : (
        <ul className="hx-sidebar__list" aria-label="세션 목록">
          {groups.map((g) => (
            <li key={g.project}>
              <h3 className="hx-sidebar__group">{g.project}</h3>
              <ul className="hx-sidebar__list" role="list">
                {g.sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      {...act('sidebar.select-session')}
                      type="button"
                      className={`hx-session hx-status--${s.status}`}
                      aria-current={s.id === activeSessionId ? 'true' : undefined}
                      onClick={() => onSelectSession?.(s.id)}
                    >
                      <span className="hx-dot" aria-label={SESSION_STATUS_LABEL[s.status]} />
                      {s.agent && (
                        <span className="hx-session__agent" title={s.agent.command} aria-hidden="true">
                          {s.agent.icon ?? '✦'}
                        </span>
                      )}
                      <span className="hx-session__title">{s.title}</span>
                      <span className="hx-session__engine">{s.engineId}</span>
                      {s.needsApproval ? (
                        <span
                          className="hx-session__approval"
                          aria-label={`확인 필요 ${s.needsApproval}건`}
                          data-testid="session-needs-approval"
                        >
                          확인 필요
                        </span>
                      ) : null}
                      {s.agent && <AgentProgress s={s} />}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <div className="hx-sidebar__nav" role="menu" aria-label="하단 메뉴">
        {NAV_ITEMS.map((n) => (
          <button
            {...act(`nav.${n.id}` as const)}
            key={n.id}
            type="button"
            role="menuitem"
            className="hx-nav-item"
            disabled={n.ready === false}
            title={n.ready === false ? NOT_READY : undefined}
            onClick={() => onNavigate?.(n.id)}
          >
            <span aria-hidden="true">{n.icon}</span>
            {n.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

/** 48.3 에이전트 세션: 현재 노드 + 진행률 막대 */
function AgentProgress({ s }: { s: SessionSummary }) {
  const pct = Math.round((s.progress ?? 0) * 100);
  return (
    <span className="hx-session__run">
      <span className="hx-session__node">
        {s.currentNode
          ? `▸ ${s.currentNode}`
          : s.status === 'running'
            ? '준비 중'
            : SESSION_STATUS_LABEL[s.status]}
      </span>
      <span
        className="hx-session__progress"
        role="progressbar"
        aria-label={`${s.title} 진행률`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="hx-session__bar" style={{ width: `${pct}%` }} />
      </span>
      <span className="hx-session__pct">{pct}%</span>
    </span>
  );
}
