/**
 * 의미 판단 AI 체인 (T-100 P1-E) 공용 타입.
 * 이 패키지는 다른 판정기 패키지에 의존하지 않는다(자체 완결).
 */

export type JudgeVerdict = 'equal' | 'different' | 'uncertain' | 'unavailable';

export type DifferenceKind = 'equivalent' | 'formatting-only' | 'wrong-value' | 'missing';

export interface JudgeRequest {
  /** 비교기 종류 (path, text, json, number, version, command-output …) */
  kind: string;
  expected: string;
  actual: string;
  itemTitle: string;
  /** 이 항목을 작성한 엔진 id (E.7: 다른 엔진 우선) */
  authorEngineId?: string;
  sessionId: string;
}

export interface JudgeOutcome {
  verdict: JudgeVerdict;
  /** 0~1, same_meaning '예' 비율 (E.10) */
  confidence: number;
  /** 판정에 쓴 엔진 id (로컬이면 'ollama') */
  engineId?: string;
  /** 실제로 받은 표본 수 */
  samples?: number;
  /** 항목 작성 엔진과 같은 엔진이 판정했는가 (E.7) */
  sameEngineJudge?: boolean;
  differenceKind?: DifferenceKind;
  /** 쉬운 말 한 문장 (승인 카드용) */
  plainReason?: string;
  /** 기계용 사유: semantic-off | limit | no-judge | timeout | invalid-answer | error | samples … */
  reason: string;
}

export type QuestionId = 'same_meaning' | 'difference_kind' | 'plain_reason';

/** 판정기 한 번 호출의 답 (요청한 질문의 필드만 채워진다) */
export interface JudgeAnswer {
  same_meaning?: 'yes' | 'no';
  difference_kind?: DifferenceKind;
  plain_reason?: string;
}

/** 판정기로 보내는 메시지 + 답 JSON 스키마 */
export interface JudgePrompt {
  questions: readonly QuestionId[];
  system: string;
  user: string;
  /** 답 JSON Schema (Ollama `format`, 엔진 프롬프트에 그대로 넣는다) */
  schema: Record<string, unknown>;
}

/** 판정 백엔드 하나 (로컬 Ollama 또는 엔진). ask는 예외를 던지지 않고 실패 시 undefined */
export interface JudgeBackend {
  readonly id: string;
  readonly via: 'engine' | 'local';
  readonly engineId: string;
  ask(prompt: JudgePrompt, signal?: AbortSignal): Promise<JudgeAnswer | undefined>;
}
