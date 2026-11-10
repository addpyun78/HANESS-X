import type { LocalLlmEntry } from '../cache.js';
import { OLLAMA_PROBE } from './ollama.js';
import { JAN_PROBE, LLAMACPP_PROBE, LMSTUDIO_PROBE, VLLM_PROBE } from './openai-compat.js';
import { PROBE_TIMEOUT_MS, runProbe, type LocalLlmProbe } from './probe.js';

export const LOCAL_LLM_PROBES: readonly LocalLlmProbe[] = [
  OLLAMA_PROBE,
  LMSTUDIO_PROBE,
  LLAMACPP_PROBE,
  VLLM_PROBE,
  JAN_PROBE,
];

export interface ProbeAllOptions {
  probes?: readonly LocalLlmProbe[];
  /** 프로브 이름 → baseUrl 교체 (테스트·원격 포트 포워딩용) */
  baseUrls?: Record<string, string>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** 12.4 모든 프로브를 병렬로 실행 (각 800ms 타임아웃). 응답한 서버만 돌려준다 */
export async function probeLocalLlms(opts: ProbeAllOptions = {}): Promise<LocalLlmEntry[]> {
  const probes = opts.probes ?? LOCAL_LLM_PROBES;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const results = await Promise.all(
    probes.map((p) =>
      runProbe(p, {
        timeoutMs,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(opts.baseUrls?.[p.name] ? { baseUrl: opts.baseUrls[p.name] } : {}),
      }),
    ),
  );
  return results.filter((r): r is LocalLlmEntry => r !== null);
}
