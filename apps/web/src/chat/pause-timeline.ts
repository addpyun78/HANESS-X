import { pausedLabel } from '../shell/paused-label.js';

/**
 * T-101 2B.12 세션 타임라인 "멈춤 → 이어감"
 * 커널 기록 session_paused / session_resumed를 채팅 흐름의 표시 줄로 바꾼다.
 */
export interface PauseMarkBlock {
  id: string;
  ts: string;
  kind: 'pause_mark';
  state: 'paused' | 'resumed';
  /** 화면에 보일 한 줄 */
  text: string;
}

const MODE_LABEL: Record<string, string> = {
  engine: '하던 대화 그대로',
  summary: '지금까지 한 일 요약으로',
};

type Rec = { id?: unknown; ts?: unknown; type?: unknown } & Record<string, unknown>;

/** session_paused / session_resumed → 표시 줄 (그 밖의 기록은 undefined) */
export function pauseMarkFrom(raw: unknown): PauseMarkBlock | undefined {
  const e = raw as Rec;
  const id = typeof e.id === 'string' ? e.id : '';
  const ts = typeof e.ts === 'string' ? e.ts : '';
  if (e.type === 'session_paused') {
    const reason = (e.paused as { reason?: string } | undefined)?.reason;
    return { id, ts, kind: 'pause_mark', state: 'paused', text: `⏸ ${pausedLabel(reason)}` };
  }
  if (e.type === 'session_resumed') {
    const how = MODE_LABEL[String(e.mode)] ?? '';
    return {
      id,
      ts,
      kind: 'pause_mark',
      state: 'resumed',
      text: how ? `▶ 이어감 (${how})` : '▶ 이어감',
    };
  }
  return undefined;
}
