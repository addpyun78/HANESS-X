import {
  buildJudgeMessages,
  extractJsonObject,
  judgeAnswerJsonSchema,
  parseJudgeAnswer,
  JudgeAnswerError,
  type JudgeAnswerFor,
  type JudgeOptions,
  type JudgeQuestion,
  type JudgeState,
  type Verifier,
} from '@harness-x/protocol';

/**
 * 로컬 대체 판정기 (26.6) — Ollama JSON 스키마 출력
 *   POST {baseUrl}/api/chat
 *   { model, stream: false, format: <답 JSON Schema>, options: { temperature: 0 }, messages: [system, user] }
 * 질문 형식(system/user 메시지·답 스키마)은 Jev와 같다(@harness-x/protocol buildJudgeMessages).
 * 오프라인·민감 프로젝트용: 데이터가 이 컴퓨터 밖으로 나가지 않는다.
 */

export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
export const LOCAL_DEFAULT_MODEL = 'qwen2.5-coder:7b';
export const LOCAL_DEFAULT_TIMEOUT_MS = 60_000;

export type FetchLike = typeof fetch;

export interface LocalVerifierSettings {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface LocalVerifierOptions extends LocalVerifierSettings {
  fetch?: FetchLike;
}

export class LocalVerifierHttpError extends Error {
  readonly code = 'LOCAL_VERIFIER_HTTP';
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LocalVerifierHttpError';
  }
}

/** OpenAI 호환 주소(…/v1)를 주면 Ollama 네이티브 주소로 바꾼다 */
export function ollamaNativeBase(u: string): string {
  return u.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** 플러그인 설정 → 로컬 판정기 설정 ({ verifier: { local: {...} } } 로 감싸도 된다) */
export function localSettingsFrom(config: Record<string, unknown>): LocalVerifierSettings {
  const nested = (config.verifier as { local?: unknown } | undefined)?.local;
  const c = (nested && typeof nested === 'object' ? nested : config) as Record<string, unknown>;
  return {
    ...(typeof c.baseUrl === 'string' ? { baseUrl: c.baseUrl } : {}),
    ...(typeof c.model === 'string' ? { model: c.model } : {}),
    ...(typeof c.timeoutMs === 'number' ? { timeoutMs: c.timeoutMs } : {}),
  };
}

export function ollamaRequestBody(
  question: JudgeQuestion,
  state: JudgeState,
  model = LOCAL_DEFAULT_MODEL,
): Record<string, unknown> {
  const m = buildJudgeMessages(question, state);
  return {
    model,
    stream: false,
    format: judgeAnswerJsonSchema(question),
    options: { temperature: 0 },
    messages: [
      { role: 'system', content: m.system },
      { role: 'user', content: m.user },
    ],
  };
}

export function parseOllamaResponse<Q extends JudgeQuestion>(question: Q, body: unknown): JudgeAnswerFor<Q> {
  const content = (body as { message?: { content?: unknown } } | null)?.message?.content;
  if (typeof content !== 'string') throw new JudgeAnswerError('Ollama 응답에 message.content가 없음', body);
  return parseJudgeAnswer(question, extractJsonObject(content));
}

export class LocalVerifier implements Verifier {
  readonly id = 'local';
  readonly model: string;
  private readonly opts: LocalVerifierOptions;

  constructor(opts: LocalVerifierOptions = {}) {
    this.opts = opts;
    this.model = opts.model ?? LOCAL_DEFAULT_MODEL;
  }

  get url(): string {
    return `${ollamaNativeBase(this.opts.baseUrl ?? OLLAMA_DEFAULT_BASE_URL)}/api/chat`;
  }

  async judge<Q extends JudgeQuestion>(
    question: Q,
    state: JudgeState,
    opts: JudgeOptions = {},
  ): Promise<JudgeAnswerFor<Q>> {
    const f = this.opts.fetch ?? fetch;
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? LOCAL_DEFAULT_TIMEOUT_MS);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await f(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ollamaRequestBody(question, state, this.model)),
        signal,
      });
    } catch (err) {
      throw new LocalVerifierHttpError(
        `Ollama 연결 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LocalVerifierHttpError(`Ollama HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    return parseOllamaResponse(question, await res.json());
  }
}
