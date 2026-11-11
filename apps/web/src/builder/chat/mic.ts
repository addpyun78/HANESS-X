/**
 * P4-B.8 마이크 버튼 상태 기계
 * idle ─누름→ (동의 필요하면 consent) → starting → recording ─누름→ stopping → idle
 * 오류는 어느 상태에서든 idle + 쉬운 말 메시지.
 */

export type MicPhase = 'idle' | 'consent' | 'starting' | 'recording' | 'stopping';

export interface MicState {
  phase: MicPhase;
  /** 녹음 시작 시각(ms) — 경과 시간 표시용 */
  startedAt?: number;
  /** 최근 소리 크기 0~1 (파형) */
  levels: number[];
  /** 말하는 중 중간 결과 */
  partial: string;
  error?: string;
}

export type MicEvent =
  | { type: 'press'; needsConsent: boolean }
  | { type: 'consent'; granted: boolean }
  | { type: 'started'; at: number }
  | { type: 'level'; level: number }
  | { type: 'partial'; text: string }
  | { type: 'stopped' }
  | { type: 'error'; message: string };

export const WAVE_BARS = 16;
export const initialMic: MicState = { phase: 'idle', levels: [], partial: '' };

export function micReducer(s: MicState, e: MicEvent): MicState {
  switch (e.type) {
    case 'press':
      if (s.phase === 'idle')
        return e.needsConsent ? { ...initialMic, phase: 'consent' } : { ...initialMic, phase: 'starting' };
      if (s.phase === 'recording') return { ...s, phase: 'stopping' };
      return s; // 시작·종료 처리 중에는 무시
    case 'consent':
      if (s.phase !== 'consent') return s;
      return e.granted ? { ...initialMic, phase: 'starting' } : initialMic;
    case 'started':
      return s.phase === 'starting' ? { ...s, phase: 'recording', startedAt: e.at } : s;
    case 'level':
      return s.phase === 'recording'
        ? { ...s, levels: [...s.levels, Math.max(0, Math.min(1, e.level))].slice(-WAVE_BARS) }
        : s;
    case 'partial':
      return s.phase === 'recording' || s.phase === 'stopping' ? { ...s, partial: e.text } : s;
    case 'stopped':
      return initialMic;
    case 'error':
      return { ...initialMic, error: e.message };
  }
}

/** 경과 시간 m:ss */
export function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
