import { isRunMode, RUN_MODE_LABEL, type RunMode } from '@harness-x/protocol';
import './run-mode.css';

/**
 * T-101 3E.5 모드 배지 (체크리스트 패널 머리. 사이드바 세션 줄은 0-2의 hx-srow__mode가 같은 이름을 쓴다)
 */

export function ModeBadge({ mode }: { mode: RunMode }) {
  return (
    <span className={`hx-mode-badge hx-mode-badge--${mode}`} aria-label={`모드 ${RUN_MODE_LABEL[mode]}`}>
      {RUN_MODE_LABEL[mode]}
    </span>
  );
}

/** 이벤트(session_registered/session_updated의 session 기록)에서 그 세션의 마지막 모드 */
export function modeFromEvents(
  events: readonly unknown[],
  sessionId: string | undefined,
): RunMode | undefined {
  if (!sessionId) return;
  for (let k = events.length - 1; k >= 0; k--) {
    const e = events[k] as { sessionId?: unknown; session?: { mode?: unknown } } | undefined;
    if (e?.sessionId !== sessionId || !e.session || typeof e.session !== 'object') continue;
    return isRunMode(e.session.mode) ? e.session.mode : undefined;
  }
  return;
}
