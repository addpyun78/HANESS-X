import { useEffect, useRef } from 'react';
import { browserNotifier, type NotifierLike } from '../panels/Approvals/useApprovals.js';
import './run-mode.css';
import { act } from '../actions/registry.js';

/**
 * T-101 3D.8 오토 종료 요약 카드: 한 일 / 못 한 일 / 확인할 것 개수 + OS 알림(브라우저 알림 — 승인 영역 알림 모듈 재사용).
 */

export interface AutoSummary {
  /** 끝낸 항목 수 */
  done: number;
  /** 못 한(blocked·남은) 항목 수 */
  notDone: number;
  /** "돌아오면 확인할 것" 수 */
  review: number;
  /** 왜 끝났나 */
  ended: 'finished' | 'paused';
}

export const AUTO_SUMMARY_TITLE: Readonly<Record<AutoSummary['ended'], string>> = Object.freeze({
  finished: '오토 실행이 끝났어요',
  paused: '오토 실행을 멈췄어요',
});

export function summaryLine(s: AutoSummary): string {
  return `한 일 ${s.done}개 · 못 한 일 ${s.notDone}개 · 확인할 것 ${s.review}개`;
}

export interface AutoSummaryCardProps {
  summary: AutoSummary;
  /** 알림 (테스트에서 바꿔 끼운다). 기본: 브라우저(OS) 알림 */
  notifier?: NotifierLike;
  onOpenReview?: () => void;
}

export function AutoSummaryCard({ summary, notifier, onOpenReview }: AutoSummaryCardProps) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const n = notifier ?? browserNotifier();
    if (n?.permission === 'granted')
      n.show(AUTO_SUMMARY_TITLE[summary.ended], summaryLine(summary), () => onOpenReview?.());
  }, [notifier, summary, onOpenReview]);
  return (
    <section className="hx-auto-summary" role="status" aria-label="오토 실행 요약">
      <strong className="hx-auto-summary__title">{AUTO_SUMMARY_TITLE[summary.ended]}</strong>
      <dl className="hx-auto-summary__counts">
        <div>
          <dt>한 일</dt>
          <dd data-testid="auto-done">{summary.done}</dd>
        </div>
        <div>
          <dt>못 한 일</dt>
          <dd data-testid="auto-not-done">{summary.notDone}</dd>
        </div>
        <div>
          <dt>확인할 것</dt>
          <dd data-testid="auto-review">{summary.review}</dd>
        </div>
      </dl>
      {summary.review > 0 && onOpenReview && (
        <button
          type="button"
          className="hx-ck-btn hx-ck-btn--primary"
          {...act('run-mode.open-review')}
          onClick={onOpenReview}
        >
          확인할 것 보기
        </button>
      )}
    </section>
  );
}
