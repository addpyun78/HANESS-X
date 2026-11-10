import { describe, expect, it } from 'vitest';
import {
  JAN_PROBE,
  LLAMACPP_PROBE,
  probeJan,
  probeLlamaCpp,
  probeVllm,
  VLLM_PROBE,
  type ProbeOptions,
} from '@harness-x/engine-scanner';
import { mockJsonServer } from './mock-server.js';

type Case = [
  string,
  typeof LLAMACPP_PROBE,
  number,
  (o?: ProbeOptions) => Promise<unknown>,
  unknown,
  string[],
];

const cases: Case[] = [
  [
    'llama.cpp',
    LLAMACPP_PROBE,
    8080,
    probeLlamaCpp,
    {
      object: 'list',
      data: [{ id: 'models/Qwen2.5-7B-Instruct-Q4_K_M.gguf', object: 'model', owned_by: 'llamacpp' }],
    },
    ['models/Qwen2.5-7B-Instruct-Q4_K_M.gguf'],
  ],
  [
    'vLLM',
    VLLM_PROBE,
    8000,
    probeVllm,
    {
      object: 'list',
      data: [{ id: 'meta-llama/Llama-3.1-8B-Instruct', object: 'model', max_model_len: 8192 }],
    },
    ['meta-llama/Llama-3.1-8B-Instruct'],
  ],
  [
    'Jan',
    JAN_PROBE,
    1337,
    probeJan,
    { object: 'list', data: [{ id: 'llama3.2-3b-instruct', object: 'model' }, { id: 'jan-nano' }] },
    ['llama3.2-3b-instruct', 'jan-nano'],
  ],
];

describe('12.3 llama.cpp·vLLM·Jan GET /v1/models', () => {
  it.each(cases)('%s: 기본 포트·모킹 서버 파싱', async (_label, def, port, probe, body, models) => {
    expect(def).toMatchObject({ port, path: '/v1/models', api: 'openai' });
    const srv = await mockJsonServer({ '/v1/models': body });
    try {
      expect(await probe({ baseUrl: srv.url })).toEqual({
        name: def.name,
        baseUrl: srv.url,
        api: 'openai',
        models,
      });
    } finally {
      await srv.close();
    }
  });
});
