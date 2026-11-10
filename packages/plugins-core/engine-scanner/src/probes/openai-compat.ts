import { runProbe, stringsOf, type LocalLlmProbe, type ProbeOptions } from './probe.js';

/** OpenAI 호환 GET /v1/models → { object: 'list', data: [{ id, ... }] } */
function openAiCompat(name: string, port: number): LocalLlmProbe {
  return {
    name,
    port,
    path: '/v1/models',
    api: 'openai',
    parse: (body) => stringsOf((body as { data?: unknown })?.data, 'id'),
  };
}

/** 12.2 LM Studio :1234 */
export const LMSTUDIO_PROBE = openAiCompat('lmstudio', 1234);

export const probeLmStudio = (opts?: ProbeOptions) => runProbe(LMSTUDIO_PROBE, opts);

/** 12.3 llama.cpp server :8080, vLLM :8000, Jan :1337 */
export const LLAMACPP_PROBE = openAiCompat('llamacpp', 8080);
export const VLLM_PROBE = openAiCompat('vllm', 8000);
export const JAN_PROBE = openAiCompat('jan', 1337);

export const probeLlamaCpp = (opts?: ProbeOptions) => runProbe(LLAMACPP_PROBE, opts);
export const probeVllm = (opts?: ProbeOptions) => runProbe(VLLM_PROBE, opts);
export const probeJan = (opts?: ProbeOptions) => runProbe(JAN_PROBE, opts);
