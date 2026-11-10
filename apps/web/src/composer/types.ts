export type AuthMode = 'subscription' | 'api';
export type PermissionMode = 'read-only' | 'workspace-write' | 'full';

export const AUTH_LABEL: Record<AuthMode, string> = { subscription: '구독', api: 'API' };
export const PERMISSION_LABEL: Record<PermissionMode, string> = {
  'read-only': '읽기 전용',
  'workspace-write': '워크스페이스 쓰기',
  full: '전체',
};
export const PERMISSION_DESC: Record<PermissionMode, string> = {
  'read-only': '파일을 읽기만 합니다',
  'workspace-write': '선택한 프로젝트 폴더 안에서만 씁니다',
  full: '모든 경로에 쓰고 명령을 실행합니다',
};

/** 세션 설정 — 다음 턴부터 적용 */
export interface ComposerSettings {
  engineId: string;
  auth: AuthMode;
  permission: PermissionMode;
}

export interface EngineOption {
  id: string;
  label: string;
  /** 감지됨(설치·활성) 여부 */
  available: boolean;
  /** 지원하는 인증 방식 (없으면 둘 다) */
  auth?: AuthMode[];
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  source: 'drop' | 'paste';
  file: File;
}

/** 첨부 이벤트 (드래그앤드롭·붙여넣기) */
export interface AttachEvent {
  type: 'attach';
  attachments: Attachment[];
}

export interface SendPayload {
  text: string;
  settings: ComposerSettings;
  attachments: Attachment[];
  /** / 팔레트로 고정한 에이전트 명령 (예: /design-qa) */
  agent?: string;
}

/** 판정 줄: 항목이 판정 사다리 몇 번째 칸에서 통과했는지 */
export interface Verdict {
  itemId: string;
  /** 1~5 (정규화·별칭 사전·내용 증거·Jev·사람) */
  rung: 1 | 2 | 3 | 4 | 5;
  passed: boolean;
}

export const RUNG_LABEL: Record<Verdict['rung'], string> = {
  1: '정규화',
  2: '별칭 사전',
  3: '내용 증거',
  4: 'Jev',
  5: '사람',
};
