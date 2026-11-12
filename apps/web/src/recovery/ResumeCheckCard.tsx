import './recovery.css';
import { act } from '../actions/registry.js';

/** kernel resume-check.ts ResumeIssue와 같은 모양 (재개 전 점검 카드 한 장) */
export interface ResumeIssueData {
  check: 'files' | 'engine' | 'version' | 'approvals' | 'stale' | 'conflict';
  title: string;
  body: string;
  choices: { id: string; label: string; recommended?: boolean; default?: boolean }[];
  list?: string[];
  blocking?: boolean;
}

export interface ResumeCheckCardProps {
  issue: ResumeIssueData;
  onChoose(check: ResumeIssueData['check'], choiceId: string): void;
}

/**
 * T-101 2B.3~2B.8 이어하기 전 점검 카드 (문제가 있을 때만 보인다).
 * 예: 2B.7 멈춘 지 7일 이상이면 "지금까지 한 일" 요약을 보여 주고 확인.
 */
export function ResumeCheckCard({ issue, onChoose }: ResumeCheckCardProps) {
  return (
    <section className="hx-resume hx-resume-check" aria-label={issue.title} data-check={issue.check}>
      <div className="hx-resume__head">
        <span aria-hidden="true">{issue.blocking ? '⚠' : 'ℹ'}</span>
        <strong>{issue.title}</strong>
      </div>
      <p className="hx-resume__body">{issue.body}</p>
      {issue.list && issue.list.length > 0 && (
        <ul className="hx-resume-check__list">
          {issue.list.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <div className="hx-resume-check__choices">
        {issue.choices.map((c) => (
          <button
            key={c.id}
            type="button"
            {...act('recovery.check-choice')}
            className={
              c.recommended || c.default
                ? 'hx-resume__button hx-resume__button--primary'
                : 'hx-resume__button'
            }
            onClick={() => onChoose(issue.check, c.id)}
          >
            {c.label}
            {c.recommended ? ' (추천)' : ''}
          </button>
        ))}
      </div>
    </section>
  );
}
