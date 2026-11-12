import { pausedAgo, type ResumableSessionData } from './resume-list.js';
import { pausedLabel } from '../shell/paused-label.js';
import './recovery.css';

export interface ProjectResumeCardProps {
  /** projectResumeList(projectId, …) 결과 */
  sessions: readonly ResumableSessionData[];
  /** [이어하기] → 재개 전 점검(2B.3)부터 */
  onResume(sessionId: string): void;
  /** 시각 계산 기준 (테스트용) */
  now?: Date;
}

/**
 * T-101 2B.1 프로젝트를 열면 보이는 "이어서 할 작업이 있어요" 카드.
 * 세션마다 제목·에이전트·진행률·멈춘 이유·멈춘 시각.
 */
export function ProjectResumeCard({ sessions, onResume, now }: ProjectResumeCardProps) {
  if (sessions.length === 0) return null;
  return (
    <section className="hx-resume hx-resume--project" aria-label="이어서 할 작업">
      <div className="hx-resume__head">
        <span aria-hidden="true">⏸</span>
        <strong>이어서 할 작업이 있어요</strong>
        <span className="hx-resume__count">{sessions.length}개</span>
      </div>
      <ul className="hx-resume__list">
        {sessions.map((s) => {
          const pct = Math.round(s.progress * 100);
          return (
            <li key={s.sessionId} className="hx-resume__item" data-testid="resume-item">
              <span className="hx-resume__title">{s.title}</span>
              {s.agent && (
                <span className="hx-resume__agent">
                  {s.agent.icon ?? '✦'} {s.agent.displayName}
                </span>
              )}
              <span
                className="hx-resume__progress"
                role="progressbar"
                aria-label={`${s.title} 진행률`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                {s.stageProgress ?? `${pct}%`}
              </span>
              <span className="hx-resume__reason">{pausedLabel(s.paused.reason)}</span>
              <time className="hx-resume__time" dateTime={s.paused.at}>
                {pausedAgo(s.paused.at, now)}
              </time>
              <button type="button" className="hx-resume__button" onClick={() => onResume(s.sessionId)}>
                이어하기
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
