/**
 * T-101 2B.13 30일 지난 미완료 세션 정리 제안 (자동 삭제 금지)
 */

export const CLEANUP_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;

export interface CleanupSuggestion {
  sessionIds: string[];
  title: string;
  body: string;
  /** [정리하기]는 사람이 눌러야 한다 — 자동 삭제 없음 */
  choices: { id: 'review' | 'later'; label: string }[];
}

/** 멈춘 지 30일이 지난 미완료 세션이 있으면 정리 제안 (삭제는 하지 않는다) */
export function staleCleanupSuggestion(
  sessions: readonly { sessionId: string; paused: { at: string } }[],
  now: Date = new Date(),
): CleanupSuggestion | null {
  const old = sessions.filter((s) => now.getTime() - Date.parse(s.paused.at) >= CLEANUP_AFTER_DAYS * DAY_MS);
  if (old.length === 0) return null;
  return {
    sessionIds: old.map((s) => s.sessionId),
    title: '오래 멈춘 작업이 있어요',
    body: `멈춘 지 ${CLEANUP_AFTER_DAYS}일이 지난 작업이 ${old.length}개 있어요. 하나씩 보고 정리할까요? 직접 고르기 전에는 지우지 않아요.`,
    choices: [
      { id: 'review', label: '하나씩 보기' },
      { id: 'later', label: '나중에' },
    ],
  };
}
