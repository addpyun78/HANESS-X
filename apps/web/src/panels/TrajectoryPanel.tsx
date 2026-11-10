import type { HarnessEvent } from '@harness-x/protocol';
import { useMemo } from 'react';
import { buildTrajectory, type StepUsage } from './trajectory.js';
import './panels.css';

const fmtTokens = (n: number) => n.toLocaleString('ko-KR');
const fmtCost = (n: number) => `$${n.toFixed(4)}`;
const time = (ts: string) => ts.slice(11, 19);

function UsageText({ u }: { u: StepUsage }) {
  return (
    <>
      입력 {fmtTokens(u.inputTokens)} · 출력 {fmtTokens(u.outputTokens)}
      {u.cacheReadTokens > 0 && ` · 캐시 ${fmtTokens(u.cacheReadTokens)}`} · {fmtCost(u.costUsd)}
    </>
  );
}

/** 37.4 궤적 패널 — 이벤트 타임라인, 단계(턴)별 토큰·비용 */
export function TrajectoryPanel({ events }: { events: readonly HarnessEvent[] }) {
  const t = useMemo(() => buildTrajectory(events), [events]);
  if (t.steps.length === 0) return <p className="hx-panel-empty">아직 기록된 이벤트가 없습니다</p>;
  return (
    <section className="hx-traj" aria-label="궤적">
      <div className="hx-traj__totals" data-testid="trajectory-totals">
        {t.steps.length}단계 · 이벤트 {t.totals.events}개 · <UsageText u={t.totals} />
      </div>
      <ol className="hx-traj__steps">
        {t.steps.map((s) => (
          <li key={s.index} className="hx-traj__step" data-step={s.index}>
            <div className="hx-traj__step-head">
              <strong>단계 {s.index + 1}</strong>
              <span className="hx-mono">
                {time(s.startTs)}–{time(s.endTs)}
              </span>
              {s.engineIds.length > 0 && <span>{s.engineIds.join(', ')}</span>}
              <span className="hx-traj__step-usage" aria-label={`단계 ${s.index + 1} 사용량`}>
                <UsageText u={s.usage} />
              </span>
            </div>
            <ol className="hx-traj__events">
              {s.entries.map((e) => (
                <li key={e.id} data-type={e.type}>
                  <span className="hx-mono">{time(e.ts)}</span> {e.label}
                  {e.itemId && <span className="hx-mono"> #{e.itemId}</span>}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );
}
