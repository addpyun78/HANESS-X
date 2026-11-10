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
