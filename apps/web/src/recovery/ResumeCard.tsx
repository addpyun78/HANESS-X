import { useState } from 'react';
import './recovery.css';

/** GET /api/recovery 의 카드 한 장 (kernel recover.ts ResumeCard와 같은 모양) */
export interface ResumeCardData {
  sessionId: string;
  engineId: string | null;
  lastEventAt: string | null;
  remaining: number | null;
  nextItemId: string | null;
  nextItemTitle: string | null;
}

export interface ResumeCardProps {
  card: ResumeCardData;
  /** [이어서 하기] → POST /api/recovery/:session/resume */
  onResume(sessionId: string): Promise<unknown> | void;
}

/** "이어서 하기" 카드: 비정상 종료된 세션을 다음 미완료 항목부터 재개한다 (T-061) */
export function ResumeCard({ card, onResume }: ResumeCardProps) {
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const resume = async () => {
    setState('pending');
    try {
      await onResume(card.sessionId);
      setState('done');
    } catch {
      setState('error');
    }
  };
  return (
    <section className="hx-resume" aria-label="이어서 하기">
      <div className="hx-resume__head">
        <span aria-hidden="true">⏸</span>
        <strong>중단된 세션</strong>
        <span className="hx-mono">{card.sessionId}</span>
        {card.remaining !== null && (
          <span className="hx-resume__count" data-testid="resume-remaining">
            남은 항목 {card.remaining}개
          </span>
        )}
      </div>
      <p className="hx-resume__body">
        {card.engineId ?? '엔진'} 실행이 끝나지 않은 채 종료되었습니다
        {card.lastEventAt ? ` (마지막 기록 ${card.lastEventAt})` : ''}.
      </p>
      {card.nextItemId && (
        <p className="hx-resume__next" data-testid="resume-next">
          다음 항목: <span className="hx-mono">{card.nextItemId}</span> {card.nextItemTitle}
        </p>
      )}
      <button
        type="button"
        className="hx-resume__button"
        onClick={() => void resume()}
        disabled={state === 'pending' || state === 'done'}
      >
        {state === 'done' ? '재개됨' : state === 'pending' ? '재개 중…' : '이어서 하기'}
      </button>
      {state === 'error' && (
        <p className="hx-resume__error" role="alert">
          재개하지 못했습니다. 다시 시도하세요.
        </p>
      )}
    </section>
  );
}
