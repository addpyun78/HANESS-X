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
 * Jev 클라이언트 (26.2)
 *
 * 전송 형식 가정(문서화): Jev는 OpenAI 호환 HTTP로 호스팅된다고 가정한다
 * (OpenRouter·Cloudflare AI 등 공개 호스팅 경로가 /chat/completions 형식).
 *   POST {endpoint}/chat/completions
 *   Authorization: Bearer {apiKey}
 *   { model: "jev-1.13.0", messages: [system, user], temperature: 0,
 *     response_format: { type: "json_schema", json_schema: { name, strict: true, schema } } }
 * 응답은 두 형식을 받는다.
 *   1) OpenAI 형식: choices[0].message.content = '{"noul":0.93,"confidence":0.88}'
 *   2) Jev 네이티브 형식: 본문 자체가 { noul | choice | score, confidence }
 * 모델은 jev-1.13.0으로 고정한다(설정에서 다른 모델을 주면 거부) — 판정 품질이 버전에 묶여 있기 때문.
 */

export const JEV_MODEL = 'jev-1.13.0';
export const JEV_DEFAULT_TIMEOUT_MS = 5_000;
export const JEV_API_KEY_ENV = 'JEV_API_KEY';

export type FetchLike = typeof fetch;

export interface JevSettings {
  /** OpenAI 호환 기준 URL (예: https://openrouter.ai/api/v1) */
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface JevClientOptions extends JevSettings {
  fetch?: FetchLike;
}

export class JevConfigError extends Error {
  readonly code = 'JEV_CONFIG';
  constructor(message: string) {
    super(message);
    this.name = 'JevConfigError';
  }
}

export class JevHttpError extends Error {
  readonly code = 'JEV_HTTP';
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'JevHttpError';
  }
}

/**
 * 플러그인 설정(ctx.config) → Jev 설정.
 *   { endpoint, apiKey? | apiKeyEnv? (기본 JEV_API_KEY), timeoutMs?, model? (jev-1.13.0만 허용) }
 * 설정은 { verifier: { jev: {...} } } 로 감싸도 된다.
 */
export function jevSettingsFrom(
  config: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
): JevSettings {
  const nested = (config.verifier as { jev?: unknown } | undefined)?.jev;
  const c = (nested && typeof nested === 'object' ? nested : config) as Record<string, unknown>;
  if (c.model !== undefined && c.model !== JEV_MODEL)
    throw new JevConfigError(`Jev 모델은 ${JEV_MODEL}로 고정입니다 (설정값: ${String(c.model)})`);
  if (typeof c.endpoint !== 'string' || !/^https?:\/\//.test(c.endpoint))
    throw new JevConfigError('Jev endpoint 설정이 없습니다 (verifier.jev.endpoint = https://…)');
  const keyEnv = typeof c.apiKeyEnv === 'string' ? c.apiKeyEnv : JEV_API_KEY_ENV;
  const apiKey = typeof c.apiKey === 'string' ? c.apiKey : env[keyEnv];
  return {
    endpoint: c.endpoint,
    ...(apiKey ? { apiKey } : {}),
    ...(typeof c.timeoutMs === 'number' ? { timeoutMs: c.timeoutMs } : {}),
  };
}

/** 요청 본문 (스냅샷 테스트·로깅용으로 공개) */
export function jevRequestBody(question: JudgeQuestion, state: JudgeState): Record<string, unknown> {
  const m = buildJudgeMessages(question, state);
  return {
    model: JEV_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: m.system },
      { role: 'user', content: m.user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: `judge_${question.kind}`, strict: true, schema: judgeAnswerJsonSchema(question) },
    },
  };
}

/** 응답 본문 → 답 (OpenAI 형식 또는 네이티브 형식) */
export function parseJevResponse<Q extends JudgeQuestion>(question: Q, body: unknown): JudgeAnswerFor<Q> {
  if (!body || typeof body !== 'object') throw new JudgeAnswerError('Jev 응답이 객체가 아님', body);
  const b = body as Record<string, unknown>;
  if (Array.isArray(b.choices)) {
    const msg = (b.choices[0] as { message?: { content?: unknown } } | undefined)?.message;
    const content = msg?.content;
    if (typeof content === 'string') return parseJudgeAnswer(question, extractJsonObject(content));
    if (content && typeof content === 'object') return parseJudgeAnswer(question, content);
    throw new JudgeAnswerError('Jev 응답에 message.content가 없음', body);
  }
  return parseJudgeAnswer(question, body);
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

export class JevClient implements Verifier {
  readonly id = 'jev';
  readonly model = JEV_MODEL;
  private readonly opts: JevClientOptions;

  constructor(opts: JevClientOptions) {
    if (!opts.endpoint) throw new JevConfigError('Jev endpoint가 필요합니다');
    this.opts = opts;
  }

  get url(): string {
    return `${trimSlash(this.opts.endpoint)}/chat/completions`;
  }

  async judge<Q extends JudgeQuestion>(
    question: Q,
    state: JudgeState,
    opts: JudgeOptions = {},
  ): Promise<JudgeAnswerFor<Q>> {
    const body = jevRequestBody(question, state);
    const f = this.opts.fetch ?? fetch;
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await f(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new JevHttpError(`Jev 네트워크 오류: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new JevHttpError(`Jev HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    return parseJevResponse(question, await res.json());
  }
}
