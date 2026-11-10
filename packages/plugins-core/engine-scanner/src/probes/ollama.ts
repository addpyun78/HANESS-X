import { runProbe, stringsOf, type LocalLlmProbe, type ProbeOptions } from './probe.js';

/** 12.1 Ollama: GET :11434/api/tags → { models: [{ name, model, ... }] } */
export const OLLAMA_PROBE: LocalLlmProbe = {
  name: 'ollama',
  port: 11434,
  path: '/api/tags',
  api: 'ollama',
  parse: (body) => stringsOf((body as { models?: unknown })?.models, 'name'),
};

export const probeOllama = (opts?: ProbeOptions) => runProbe(OLLAMA_PROBE, opts);
