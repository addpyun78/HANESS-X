import { pausedLabel } from '../shell/paused-label.js';

/** GET /api/resume 의 세션 한 개 (kernel resume.ts ResumableSession과 같은 모양) */
export interface ResumableSessionData {
  sessionId: string;
  projectId: string | null;
  title: string;
  agent: { name: string; command: string; displayName: string; icon?: string } | null;
  engineId: string | null;
  progress: number;
  paused: { reason: string; at: string; by: string };
  nodeId?: string;
  itemId?: string;
  startedAt: string | null;
  /** T-101 4F.6 단계가 있는 에이전트: "단계 2/3 · 항목 4/7" */
  stageProgress?: string;
}

/**
 * T-101 2B.1 프로젝트 id → 미완료 세션 목록 (멈춘 시각 최신순)
 * 사이드바 프로젝트 클릭·폴더 선택·최근 프로젝트(0-2)가 이 함수로 카드를 채운다.
 */
export function projectResumeList(
  projectId: string,
  sessions: readonly ResumableSessionData[],
): ResumableSessionData[] {
  return sessions
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => b.paused.at.localeCompare(a.paused.at));
}

/** 가져오기: GET /api/resume?projectId= (클라이언트 request 함수 주입) */
export async function fetchProjectResumeList(
  request: <T>(path: string) => Promise<T>,
  projectId: string,
): Promise<ResumableSessionData[]> {
  const r = await request<{ sessions: ResumableSessionData[] }>(
    `/api/resume?projectId=${encodeURIComponent(projectId)}`,
  );
  return projectResumeList(projectId, r.sessions);
}

/** 멈춘 시각을 쉬운 말로: 방금 / N분 전 / N시간 전 / N일 전 */
export function pausedAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return '방금';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** 카드 한 줄 요약: 멈춘 이유 · 멈춘 시각 */
export function resumeLine(s: ResumableSessionData, now?: Date): string {
  return `${pausedLabel(s.paused.reason)} · ${pausedAgo(s.paused.at, now)}`;
}
