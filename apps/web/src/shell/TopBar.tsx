import type { ReactNode } from 'react';
import { ThemeToggle } from '../design/ThemeToggle.js';
import { WorkspaceBar } from './WorkspaceBar.js';
import { RUN_STATE_LABEL, type QuotaMeter, type RunState, type Workspace } from './types.js';

export interface TopBarProps {
  workspace?: Workspace;
  runState: RunState;
  quotas: QuotaMeter[];
  /** 좁은 화면에서 왼쪽(메뉴)·오른쪽(패널) 시트 여는 버튼 */
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function TopBar({ workspace, runState, quotas, leading, trailing }: TopBarProps) {
  return (
    <header className="hx-topbar" role="banner">
      {leading}
      <WorkspaceBar workspace={workspace} />
      <span
        className={`hx-run hx-run--${runState}`}
        role="status"
        aria-label={`실행 상태: ${RUN_STATE_LABEL[runState]}`}
      >
        <span className="hx-dot" aria-hidden="true" />
        {RUN_STATE_LABEL[runState]}
      </span>
      <div className="hx-quotas" aria-label="엔진별 쿼터">
        {quotas.map((q) => (
          <QuotaMeterView key={q.engineId} q={q} />
        ))}
      </div>
      <ThemeToggle />
      {trailing}
    </header>
  );
}

function QuotaMeterView({ q }: { q: QuotaMeter }) {
  const pct = q.ratio === undefined ? undefined : Math.round(Math.min(1, Math.max(0, q.ratio)) * 100);
  const level = pct === undefined ? 'unknown' : pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'ok';
  return (
    <div
      className="hx-quota"
      data-engine={q.engineId}
      data-level={level}
      title={pct === undefined ? `${q.label}: 쿼터 정보 없음` : `${q.label}: ${pct}%`}
    >
      <span className="hx-quota__label">{q.label}</span>
      <span
        className="hx-quota__bar"
        role="meter"
        aria-label={`${q.label} 쿼터`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="hx-quota__fill" style={{ width: `${pct ?? 0}%` }} />
      </span>
    </div>
  );
}
