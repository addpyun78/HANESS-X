import type { LocalLlmEntry } from '../cache.js';

/** 로컬 LLM 서버 프로브 공통 (127.0.0.1 루프백만, 기본 800ms 타임아웃) */

export const PROBE_TIMEOUT_MS = 800;
export const PROBE_HOST = '127.0.0.1';

export type LocalLlmApi = LocalLlmEntry['api'];

export interface LocalLlmProbe {
  name: string;
  port: number;
  /** 모델 목록 경로 */
  path: string;
  api: LocalLlmApi;
  parse(body: unknown): string[];
}

export interface ProbeOptions {
  /** 기본 http://127.0.0.1:<port> — 테스트에서 모킹 서버로 교체 */
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** 서버가 응답하면 모델 목록 항목, 닫혀 있거나 시간 초과·형식 불일치면 null */
export async function runProbe(probe: LocalLlmProbe, opts: ProbeOptions = {}): Promise<LocalLlmEntry | null> {
  const baseUrl = (opts.baseUrl ?? `http://${PROBE_HOST}:${probe.port}`).replace(/\/+$/, '');
  const f = opts.fetch ?? fetch;
  try {
    const res = await f(baseUrl + probe.path, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? PROBE_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const models = probe.parse(await res.json());
    return { name: probe.name, baseUrl, api: probe.api, models };
  } catch {
    return null;
  }
}

export function stringsOf(list: unknown, key: string): string[] {
  if (!Array.isArray(list)) throw new Error('모델 목록 형식 아님');
  return list
    .map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>)[key] : undefined))
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}
