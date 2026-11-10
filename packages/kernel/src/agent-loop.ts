/**
 * 하네스 자체 도구 루프 (API 엔진용)
 * 모델 API(OpenAI 호환·Anthropic·Gemini 등)는 ModelClient로 추상화하고,
 * 루프·도구 실행·훅 연동은 하네스가 소유한다.
 */

// ── 모델 클라이언트 추상화 ───────────────────────────────────────
export interface ToolCallRequest {
  /** 모델이 준 호출 ID (없으면 클라이언트가 만든다) */
  id: string;
  name: string;
  /** 파싱된 인자 (JSON 파싱 실패 시 원문 문자열) */
  arguments: unknown;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (object) */
  parameters: Record<string, unknown>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCallRequest[];
  usage?: ModelUsage;
  /** 공급자 종료 사유 원문 (stop, tool_calls, end_turn …) */
  finishReason?: string;
}

export interface ModelRequest {
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
  /** 스트리밍 텍스트 조각 */
  onText?(delta: string): void;
}

export interface ModelClient {
  complete(req: ModelRequest): Promise<ModelTurn>;
}

/** 모델 API 오류 (HTTP 상태 포함) */
export class ModelApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ModelApiError';
  }
}
