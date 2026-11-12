import { useEffect, useState } from 'react';
import { changeText, doneText, NOTHING_FOUND, progressMark, type ScanProgressView } from './model.js';
import type { BubblePhase } from './useEngineScan.js';
import './engines.css';
import { act } from '../actions/registry.js';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 5A.8 움직임 줄이기 설정 (prefers-reduced-motion) */
export function useReducedMotion(): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(REDUCED_MOTION_QUERY).matches
      : false;
  const [reduced, setReduced] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

export interface ScanBubbleProps {
  phase: BubblePhase;
  progress: ScanProgressView | undefined;
  /** 5A.7 [설치 관리에서 찾기] */
  onOpenInstall?: () => void;
  onDismiss?: () => void;
  /** 테스트용: 움직임 줄이기 강제 */
  reducedMotion?: boolean;
}

/**
 * 5A.3 시작 화면 가운데 말풍선: ● ● ● 엔진을 찾고 있어요… + 엔진별 진행(… → ✓ / 로그인 필요 / 없음).
 * 말풍선은 클릭이 통과한다(입력창은 그대로 쓸 수 있음). 완료 문구는 1.5초 뒤 사라진다(5A.4).
 * 0개면 쉬운 말 카드 + [설치 관리에서 찾기](5A.7) — 이 카드만 클릭을 받는다.
 */
export function ScanBubble({ phase, progress, onOpenInstall, onDismiss, reducedMotion }: ScanBubbleProps) {
  const prefersReduced = useReducedMotion();
  const reduced = reducedMotion ?? prefersReduced;
  if (phase === 'hidden' || !progress) return null;

  if (phase === 'empty')
    return (
      <div className="hx-scan-layer">
        <section className="hx-scan-card" role="alert" aria-label="엔진 찾기 결과">
          <p className="hx-scan-card__title">{NOTHING_FOUND}</p>
          <p className="hx-scan-card__desc">설치 관리에서 쓸 수 있는 AI를 찾아 설치할 수 있어요.</p>
          <div className="hx-scan-card__actions">
            <button type="button" className="hx-icon-btn" {...act('scan.open-install')} onClick={onOpenInstall}>
              설치 관리에서 찾기
            </button>
            {onDismiss && (
              <button type="button" className="hx-icon-btn" {...act('scan.dismiss')} onClick={onDismiss}>
                닫기
              </button>
            )}
          </div>
        </section>
      </div>
    );

  const label = (name: string) => progress.engines.find((e) => e.name === name)?.label ?? name;
  const change = phase === 'done' ? changeText(progress, label) : undefined;
  return (
    <div className="hx-scan-layer" aria-hidden={false}>
      <div
        className="hx-scan-bubble"
        role="status"
        aria-live="polite"
        data-phase={phase}
        data-reduced={reduced || undefined}
      >
        {phase === 'scanning' ? (
          <>
            <p className="hx-scan-bubble__title">
              {reduced ? (
                <span className="hx-scan-dots" data-static="true" aria-hidden="true">
                  …
                </span>
              ) : (
                <span className="hx-scan-dots" aria-hidden="true">
                  <span>●</span>
                  <span>●</span>
                  <span>●</span>
                </span>
              )}
              엔진을 찾고 있어요…
            </p>
            <ul className="hx-scan-bubble__list">
              {progress.engines.map((e) => (
                <li key={e.name} data-state={e.state}>
                  <span className="hx-scan-bubble__mark">{progressMark(e.state)}</span> {e.label}
                  {e.models !== undefined ? `(${e.models})` : ''}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="hx-scan-bubble__title">{doneText(progress)}</p>
            {change && <p className="hx-scan-bubble__change">{change}</p>}
          </>
        )}
      </div>
    </div>
  );
}
