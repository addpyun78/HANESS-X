import type { HarnessEvent } from './events.js';
import type { AuthMode } from './pipeline.js';
import type { RunMode } from './run-mode.js';

/**
 * 엔진 어댑터 공통 인터페이스
 * Claude Code·Codex·Antigravity·로컬 LLM 등 모든 엔진은 이 형태로 하네스에 꽂힌다.
 * 어댑터는 엔진 고유 출력을 HarnessEvent로 정규화해 내보낸다.
 */

export type PermissionMode = 'read-only' | 'workspace-write' | 'full-access';

export interface EngineCapabilities {
  /** 엔진 자체 Stop 훅 지원 (없으면 하네스가 turn_end 후 재주입) */
  nativeStopHook: boolean;
  /** 세션 재개 지원 */
  resume: boolean;
  /** MCP 서버 연결 지원 */
  mcp: boolean;
  /** 실행 중 중단 지원 */
  interrupt: boolean;
}

/** 체크리스트 Stop 처리 경로: 엔진 네이티브 Stop 훅, 또는 하네스가 turn_end 후 재주입 */
export type StopStrategy = 'native-hook' | 'harness-reinject';

export function selectStopStrategy(caps: Pick<EngineCapabilities, 'nativeStopHook'>): StopStrategy {
  return caps.nativeStopHook ? 'native-hook' : 'harness-reinject';
}

export interface McpServerRef {
  name: string;
  /** stdio 실행 */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** streamable HTTP */
  url?: string;
  headers?: Record<string, string>;
}

export interface EngineRunOptions {
  /** 하네스 세션 ID (이벤트의 sessionId) */
  sessionId: string;
  prompt: string;
  cwd: string;
  model?: string;
  permission?: PermissionMode;
  /**
   * T-101 3B.3·3D.6 실행 모드. 엔진이 아는 모드로 바꿔 넘긴다(claude --permission-mode, codex --sandbox).
   * 모르는 엔진은 무시하고, 최종 판단은 하네스 permission-gate(모드 게이트)가 한다.
   */
  mode?: RunMode;
  auth?: AuthMode;
  /** 엔진 자체 세션 ID로 재개 */
  resumeId?: string;
  /** 자식 프로세스 환경변수 (secrets 모듈이 인증 모드에 맞게 만든 것) */
  env?: Record<string, string | undefined>;
  mcpServers?: McpServerRef[];
  /** 현재 체크리스트 항목 */
  itemId?: string;
  signal?: AbortSignal;
}

export interface EngineRun {
  /** 정규화된 이벤트 스트림 (turn_end로 끝난다) */
  events: AsyncIterable<HarnessEvent>;
  /** 엔진 자체 세션 ID (알게 되면 채워짐) */
  engineSessionId(): string | undefined;
  /** 중단 (프로세스 그룹 종료 등) */
  interrupt(): Promise<void>;
  /** 종료 대기 */
  done: Promise<{ exitCode: number | null }>;
}

export interface EngineAdapter {
  /** 예: claude-code, codex, antigravity, openai-compat:ollama */
  id: string;
  displayName: string;
  capabilities: EngineCapabilities;
  run(opts: EngineRunOptions): EngineRun;
}

/** 엔진 오류 분류 코드 (error 이벤트의 code) */
export const ENGINE_ERROR_CODES = [
  'quota_exceeded',
  'auth_required',
  'rate_limited',
  'network',
  'invalid_request',
  'engine_crashed',
  'unknown',
] as const;
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];
