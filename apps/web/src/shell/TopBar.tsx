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
  /** T-101 2A.8 상단 바 동작 (예: [전체 정지]) */
  actions?: ReactNode;
}

export function TopBar({ workspace, runState, quotas, leading, trailing, actions }: TopBarProps) {
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
      {actions}
      <ThemeToggle />
      {trailing}
    </header>
  );
}

/** 60.2 막대 색: 80% 이상 노랑(warning), 95% 이상 빨강(danger) — packages/kernel/src/quota.ts와 같은 기준 */
export const QUOTA_WARNING_RATIO = 0.8;
export const QUOTA_DANGER_RATIO = 0.95;

export function quotaLevel(ratio: number | undefined): 'ok' | 'warning' | 'danger' | 'unknown' {
  if (ratio === undefined || !Number.isFinite(ratio)) return 'unknown';
  return ratio >= QUOTA_DANGER_RATIO ? 'danger' : ratio >= QUOTA_WARNING_RATIO ? 'warning' : 'ok';
}

function quotaTitle(q: QuotaMeter, pct: number | undefined): string {
  const parts = [pct === undefined ? `${q.label}: 쿼터 정보 없음` : `${q.label}: ${pct}%`];
  if (q.totalTokens !== undefined) parts.push(`토큰 ${q.totalTokens.toLocaleString('ko-KR')}`);
  if (q.requests !== undefined) parts.push(`요청 ${q.requests.toLocaleString('ko-KR')}`);
  if (q.costUsd !== undefined) parts.push(`${q.costEstimated ? '추정 ' : ''}$${q.costUsd.toFixed(2)}`);
  return parts.join(' · ');
}

function QuotaMeterView({ q }: { q: QuotaMeter }) {
  const ratio = q.ratio === undefined ? undefined : Math.min(1, Math.max(0, q.ratio));
  const pct = ratio === undefined ? undefined : Math.round(ratio * 100);
  const level = quotaLevel(ratio);
  return (
    <div className="hx-quota" data-engine={q.engineId} data-level={level} title={quotaTitle(q, pct)}>
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
