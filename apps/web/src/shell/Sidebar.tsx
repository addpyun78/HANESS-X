import type { ReactNode } from 'react';
import { NAV_ITEMS, SESSION_STATUS_LABEL, type NavTarget, type SessionSummary } from './types.js';

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
      <button type="button" className="hx-sidebar__new" onClick={onNewSession}>
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
                      type="button"
                      className={`hx-session hx-status--${s.status}`}
                      aria-current={s.id === activeSessionId ? 'true' : undefined}
                      onClick={() => onSelectSession?.(s.id)}
                    >
                      <span className="hx-dot" aria-label={SESSION_STATUS_LABEL[s.status]} />
                      <span className="hx-session__title">{s.title}</span>
                      <span className="hx-session__engine">{s.engineId}</span>
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
    </nav>
  );
}
