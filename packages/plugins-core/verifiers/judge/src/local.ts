import { parseJudgeAnswer } from './questions.js';
import { JUDGE_DEFAULT_LOCAL_TIMEOUT_MS } from './settings.js';
import type { JudgeAnswer, JudgeBackend, JudgePrompt } from './types.js';

/**
 * E.3 로컬 판정기 — Ollama
 *   POST {baseUrl}/api/chat
 *   { model, stream: false, format: <질문별 답 JSON Schema>, options: { temperature: 0 }, messages: [system, user] }
 * E.4 답이 스키마와 맞지 않으면 1회 재요청, 또 실패하면 undefined(= unavailable). 예외는 던지지 않는다.
 * (verifier-local/src/ollama.ts의 요청 형식을 이 패키지로 옮긴 것)
 */

export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
export const LOCAL_JUDGE_DEFAULT_MODEL = 'qwen2.5-coder:7b';
export const LOCAL_JUDGE_ENGINE_ID = 'ollama';
/** 스키마 불일치 시 재요청 횟수 */
export const LOCAL_SCHEMA_RETRIES = 1;

export type FetchLike = typeof fetch;

/** OpenAI 호환 주소(…/v1)를 주면 Ollama 네이티브 주소로 바꾼다 */
export function ollamaNativeBase(u: string): string {
  return u.replace(/\/+$/, '').replace(/\/v1$/, '');
}

export function ollamaChatBody(prompt: JudgePrompt, model: string): Record<string, unknown> {
  return {
    model,
    stream: false,
    format: prompt.schema,
    options: { temperature: 0 },
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  };
}

/** Ollama /api/chat 응답 본문 → 검증된 답 (안 맞으면 undefined) */
export function parseOllamaChat(prompt: JudgePrompt, body: unknown): JudgeAnswer | undefined {
  const content = (body as { message?: { content?: unknown } } | null)?.message?.content;
  if (typeof content !== 'string') return undefined;
  return parseJudgeAnswer(content, prompt.questions);
}

export interface OllamaStatus {
  running: boolean;
  models: string[];
}

/** GET /api/tags 로 기동 여부·모델 목록 확인 (실패해도 예외 없음) */
export async function probeOllama(
  opts: { baseUrl?: string; fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<OllamaStatus> {
  const f = opts.fetch ?? fetch;
  try {
    const res = await f(`${ollamaNativeBase(opts.baseUrl ?? OLLAMA_DEFAULT_BASE_URL)}/api/tags`, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 1500),
    });
    if (!res.ok) return { running: false, models: [] };
    const body = (await res.json()) as { models?: { name?: unknown; model?: unknown }[] };
    const models = (body.models ?? [])
      .map((m) => (typeof m.name === 'string' ? m.name : typeof m.model === 'string' ? m.model : ''))
      .filter(Boolean);
    return { running: true, models };
  } catch {
    return { running: false, models: [] };
  }
}

/** 'qwen3' 과 'qwen3:latest' 는 같은 모델 */
export function sameOllamaModel(a: string, b: string): boolean {
  const n = (s: string) => (s.includes(':') ? s : `${s}:latest`);
  return n(a) === n(b);
}

/** 설정 모델이 있으면 그것만, 없으면 기본 모델 → 첫 모델. 쓸 모델이 없으면 undefined */
export function pickLocalModel(wanted: string, available: readonly string[]): string | undefined {
  if (wanted) return available.find((m) => sameOllamaModel(m, wanted));
  return available.find((m) => sameOllamaModel(m, LOCAL_JUDGE_DEFAULT_MODEL)) ?? available[0];
}

export interface LocalJudgeOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

export interface LocalJudgeBackend extends JudgeBackend {
  readonly model: string;
  readonly url: string;
}

export function createLocalJudge(opts: LocalJudgeOptions = {}): LocalJudgeBackend {
  const model = opts.model || LOCAL_JUDGE_DEFAULT_MODEL;
  const url = `${ollamaNativeBase(opts.baseUrl ?? OLLAMA_DEFAULT_BASE_URL)}/api/chat`;
  const timeoutMs = opts.timeoutMs ?? JUDGE_DEFAULT_LOCAL_TIMEOUT_MS;

  async function once(
    prompt: JudgePrompt,
    signal?: AbortSignal,
  ): Promise<'http-error' | JudgeAnswer | undefined> {
    const f = opts.fetch ?? fetch;
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ollamaChatBody(prompt, model)),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!res.ok) return 'http-error';
      const body: unknown = await res.json().catch(() => undefined);
      return parseOllamaChat(prompt, body);
    } catch {
      return 'http-error';
    }
  }

  return {
    id: `ollama:${model}`,
    via: 'local',
    engineId: LOCAL_JUDGE_ENGINE_ID,
    model,
    url,
    async ask(prompt, signal) {
      for (let attempt = 0; attempt <= LOCAL_SCHEMA_RETRIES; attempt++) {
        if (signal?.aborted) return undefined;
        const r = await once(prompt, signal);
        // 연결·HTTP 실패는 재요청해도 의미 없다 → 바로 unavailable
        if (r === 'http-error') return undefined;
        if (r) return r;
      }
      return undefined;
    },
  };
}
