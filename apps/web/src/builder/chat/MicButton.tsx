import { useEffect, useReducer, useRef, useState } from 'react';
import { CONSENT_NOTICE } from '@harness-x/stt-browser';
import { formatElapsed, initialMic, micReducer, WAVE_BARS } from './mic.js';
import type { SttHandle } from './stt.js';

export interface MicButtonProps {
  stt: SttHandle;
  /** 확정된 글 → 입력창에 채운다 (보내지 않는다) */
  onText: (text: string) => void;
  /** 시각 (테스트 주입) */
  now?: () => number;
}

/**
 * P4-B.8 마이크 버튼(🎤): 누르면 녹음, 다시 누르면 종료. 녹음 중 파형·경과 시간 표시.
 * P4-B.6 브라우저 음성 인식은 첫 녹음 전에 동의 안내를 띄운다.
 */
export function MicButton({ stt, onText, now = Date.now }: MicButtonProps) {
  const [s, dispatch] = useReducer(micReducer, initialMic);
  const [tick, setTick] = useState(0);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // 변환기 콜백 연결
  useEffect(() => {
    stt.onPartial = (text) => dispatch({ type: 'partial', text });
    stt.onFinal = (text) => onTextRef.current(text);
    stt.onLevel = (level) => dispatch({ type: 'level', level });
    stt.onError = (err) => dispatch({ type: 'error', message: err.message });
    return () => {
      stt.onPartial = undefined;
      stt.onFinal = undefined;
      stt.onLevel = undefined;
      stt.onError = undefined;
    };
  }, [stt]);

  // 시작·종료 부수 효과
  useEffect(() => {
    if (s.phase === 'starting')
      stt.start().then(
        () => dispatch({ type: 'started', at: now() }),
        (err: unknown) =>
          dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
    if (s.phase === 'stopping')
      stt.stop().then(
        () => dispatch({ type: 'stopped' }),
        (err: unknown) =>
          dispatch({ type: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
  }, [s.phase, stt, now]);

  // 경과 시간 갱신 (녹음 중 1초마다)
  useEffect(() => {
    if (s.phase !== 'recording') return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [s.phase]);

  const recording = s.phase === 'recording';
  const busy = s.phase === 'starting' || s.phase === 'stopping';
  const bars = Array.from({ length: WAVE_BARS }, (_, i) => s.levels[s.levels.length - WAVE_BARS + i] ?? 0);

  return (
    <span className="hx-mic" data-phase={s.phase}>
      <button
        type="button"
        className="hx-mic__btn"
        aria-label={recording ? '녹음 끝내기' : '말로 입력'}
        aria-pressed={recording}
        disabled={busy || s.phase === 'consent'}
        onClick={() => dispatch({ type: 'press', needsConsent: stt.needsConsent })}
      >
        🎤
      </button>
      {recording && (
        <span className="hx-mic__live" role="status" aria-label="녹음 중">
          <span className="hx-mic__wave" data-testid="mic-wave" aria-hidden="true">
            {bars.map((v, i) => (
              <span key={i} className="hx-mic__bar" style={{ height: `${Math.round(15 + v * 85)}%` }} />
            ))}
          </span>
          <span className="hx-mic__elapsed" data-testid="mic-elapsed" data-tick={tick}>
            {formatElapsed(now() - (s.startedAt ?? now()))}
          </span>
        </span>
      )}
      {s.phase === 'stopping' && <span className="hx-mic__note">글로 바꾸는 중…</span>}
      {s.partial && (recording || s.phase === 'stopping') && (
        <span className="hx-mic__partial" aria-live="polite">
          {s.partial}
        </span>
      )}
      {s.error && (
        <span className="hx-mic__error" role="alert">
          {s.error}
        </span>
      )}
      {s.phase === 'consent' && (
        <div className="hx-mic__consent" role="dialog" aria-label="음성 입력 동의">
          <p>{CONSENT_NOTICE}</p>
          <div className="hx-mic__consent-actions">
            <button
              type="button"
              onClick={() => {
                stt.grantConsent();
                dispatch({ type: 'consent', granted: true });
              }}
            >
              동의하고 녹음
            </button>
            <button type="button" onClick={() => dispatch({ type: 'consent', granted: false })}>
              취소
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
