/** 앱 셸이 쓰는 화면 모델 (커널 API 응답을 이 모양으로 옮겨 넣는다) */

export interface Workspace {
  /** 프로젝트 이름 (보통 폴더 이름) */
  name: string;
  /** 실제 경로 */
  path: string;
  /** git 브랜치 (없으면 표시 안 함) */
  branch?: string;
  /** AGENTS.md / CLAUDE.md 존재 표시 */
  hasAgentsMd?: boolean;
  hasClaudeMd?: boolean;
}

export type RunState = 'idle' | 'running' | 'blocked' | 'error';

export const RUN_STATE_LABEL: Record<RunState, string> = {
  idle: '대기',
  running: '실행 중',
  blocked: '차단됨',
  error: '오류',
};

export interface QuotaMeter {
  engineId: string;
  label: string;
  /** 한도 대비 사용률 0~1 (모르면 생략 → 빈 자리) */
  ratio?: number;
}

export type SessionStatus = 'running' | 'idle' | 'done' | 'blocked' | 'error';

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  running: '실행 중',
  idle: '대기',
  done: '완료',
  blocked: '차단됨',
  error: '오류',
};

export interface SessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  /** 프로젝트(워크스페이스) 이름 */
  project: string;
  engineId: string;
  /** ISO 시각 */
  updatedAt: string;
}

export type NavTarget = 'agent-builder' | 'plugins' | 'skills' | 'engines' | 'settings';

export const NAV_ITEMS: { id: NavTarget; label: string; icon: string }[] = [
  { id: 'agent-builder', label: '에이전트 만들기', icon: '✦' },
  { id: 'plugins', label: '플러그인', icon: '⧉' },
  { id: 'skills', label: '스킬', icon: '◇' },
  { id: 'engines', label: '엔진', icon: '⚙' },
  { id: 'settings', label: '설정', icon: '☰' },
];
