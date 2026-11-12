/**
 * T-101 2A 수동 정지
 *  - 정지 3종: ⏸ 일시정지(안전한 지점에서 멈춤) / ⏹ 지금 멈추기 / 전체 정지(실행 중 세션 전부)
 *  - 안전한 지점 = 도구 실행이 끝난 뒤, 다음 AI 턴 전 (2A.3)
 *  - 멈춘 세션은 paused{reason, at, by}를 갖고 나중에 이어할 수 있다 (2A.6·2B)
 */

/** 정지 3종 */
export const STOP_KINDS = ['pause', 'stop-now', 'stop-all'] as const;
export type StopKind = (typeof STOP_KINDS)[number];

/** 멈춘 이유: 사용자 / 사용량 한도 / 오류 / 승인 대기 / 예산 */
export const PAUSE_REASONS = ['user', 'quota', 'crash', 'approval', 'budget'] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export interface PausedInfo {
  reason: PauseReason;
  /** 멈춘 시각 (ISO) */
  at: string;
  /** 누가 멈췄나 (예: 'user', 'quota-router', 'kernel') */
  by: string;
}

/** 일시정지 요청 뒤 이 시간 안에 안전한 지점이 오지 않으면 "지금 멈출까요?"를 묻는다 */
export const PAUSE_SAFE_POINT_TIMEOUT_MS = 60_000;
/** 지금 멈추기: 엔진 interrupt 뒤 이 시간 안에 안 끝나면 강제 종료 */
export const STOP_NOW_GRACE_MS = 3_000;

export function isStopKind(v: unknown): v is StopKind {
  return typeof v === 'string' && (STOP_KINDS as readonly string[]).includes(v);
}

export function isPauseReason(v: unknown): v is PauseReason {
  return typeof v === 'string' && (PAUSE_REASONS as readonly string[]).includes(v);
}

/** 사이드바·카드에 쓰는 쉬운 말 이유 */
export const PAUSE_REASON_LABEL: Record<PauseReason, string> = {
  user: '사용자가 멈춤',
  quota: '사용량 한도에 닿음',
  crash: '오류로 멈춤',
  approval: '승인을 기다림',
  budget: '예산을 다 씀',
};

/** 정지 요청 결과 */
export interface StopResult {
  sessionId: string;
  kind: StopKind;
  /** 'pausing' = 안전한 지점을 기다리는 중, 'paused' = 멈춤 */
  state: 'pausing' | 'paused' | 'not_running';
}

// ── 2A.3 안전한 지점 ────────────────────────────────────────────
/**
 * 안전한 지점인가: 도구 실행이 끝났거나(tool_result) 턴·노드가 끝났다(turn_end·node_end).
 * 이 기록 바로 뒤, 다음 AI 턴이 시작되기 전에 멈추면 반쯤 쓴 파일이 남지 않는다.
 */
export function isSafePoint(rec: { type: string }): boolean {
  return rec.type === 'tool_result' || rec.type === 'turn_end' || rec.type === 'node_end';
}

export interface PauseGateOptions {
  /** 기본 PAUSE_SAFE_POINT_TIMEOUT_MS (60초) */
  timeoutMs?: number;
  /** 시간 안에 안전한 지점이 오지 않았다 → "지금 멈출까요?" 묻기 */
  onTimeout?: () => void;
}

/**
 * 일시정지 요청 상태. request() 뒤 atSafePoint()가 처음 불릴 때 멈춘다(true).
 * timeoutMs 안에 안전한 지점이 오지 않으면 onTimeout을 한 번 부른다.
 */
export class PauseGate {
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timedOut = false;
  constructor(private readonly opts: PauseGateOptions = {}) {}

  /** 일시정지 요청. 처음 요청이면 true */
  request(): boolean {
    if (this.pending) return false;
    this.pending = true;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.pending) return;
      this.timedOut = true;
      this.opts.onTimeout?.();
    }, this.opts.timeoutMs ?? PAUSE_SAFE_POINT_TIMEOUT_MS);
    return true;
  }

  get requested(): boolean {
    return this.pending;
  }

  /** 시간이 지나 "지금 멈출까요?"를 물었는가 */
  get askedStopNow(): boolean {
    return this.timedOut;
  }

  /** 안전한 지점에 왔다: 요청이 있었으면 true (호출한 쪽이 멈춘다) */
  atSafePoint(): boolean {
    if (!this.pending) return false;
    this.dispose();
    return true;
  }

  /** 요청 취소·정리 (타이머 해제) */
  dispose(): void {
    this.pending = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/** "지금 멈출까요?" 질문 (pause_timeout 기록·카드 문구) */
export const PAUSE_TIMEOUT_QUESTION = {
  title: '지금 멈출까요?',
  body: '1분이 지나도 멈추기 좋은 때가 오지 않았어요. 지금 멈추면 하던 일이 중간에 끊길 수 있어요.',
  choices: ['지금 멈추기', '계속 기다리기'],
} as const;
