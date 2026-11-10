import { ModelApiError } from '@harness-x/kernel';
import { parseSse, type SseMessage } from './sse.js';

export type FetchLike = typeof fetch;

/** JSON 본문을 POST하고 SSE 응답을 메시지 단위로 돌려준다. 2xx가 아니면 ModelApiError */
export async function* postSse(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: { signal?: AbortSignal; fetch?: FetchLike } = {},
): AsyncGenerator<SseMessage> {
  const f = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new ModelApiError(`network: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ModelApiError(`HTTP ${res.status}: ${text.slice(0, 500)}`, res.status, text);
  }
  if (!res.body) throw new ModelApiError('응답 본문 없음', res.status);
  yield* parseSse(res.body);
}

export function parseArgs(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}
