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
  /** 60.1 집계값 (툴팁) */
  totalTokens?: number;
  requests?: number;
  costUsd?: number;
  costEstimated?: boolean;
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
  /** 48.3 / 디스패치로 시작한 에이전트 세션 */
  agent?: SessionAgent;
  /** 실행 중인 노드 */
  currentNode?: string;
  /** 진행률 0~1 */
  progress?: number;
  /** T-100 H.12 대기 중인 승인 카드 수 ("확인 필요" 배지) */
  needsApproval?: number;
}

export interface SessionAgent {
  name: string;
  command: string;
  icon?: string;
}

export type NavTarget = 'agent-builder' | 'plugins' | 'skills' | 'install' | 'engines' | 'settings';

/** `ready: false` = 아직 화면이 없음 → 비활성 + "준비 중이에요" (T-101 0C.8). 화면을 연결하면 지운다 */
export const NAV_ITEMS: { id: NavTarget; label: string; icon: string; ready?: false }[] = [
  { id: 'agent-builder', label: '에이전트 만들기', icon: '✦' },
  { id: 'plugins', label: '플러그인', icon: '⧉' },
  { id: 'skills', label: '스킬', icon: '◇' },
  // T-100 P2-G.1 설치 관리 (앱·도구·모델·확장)
  { id: 'install', label: '설치 관리', icon: '⬇' },
  { id: 'engines', label: '엔진', icon: '⚙' },
  { id: 'settings', label: '설정', icon: '☰' },
];
