import { describe, expect, it } from 'vitest';
import { OLLAMA_PROBE, probeOllama } from '@harness-x/engine-scanner';
import { closedPort, mockJsonServer } from './mock-server.js';

describe('12.1 Ollama GET :11434/api/tags', () => {
  it('기본 대상은 127.0.0.1:11434/api/tags', () => {
    expect(OLLAMA_PROBE).toMatchObject({ port: 11434, path: '/api/tags', api: 'ollama' });
  });

  it('모킹 서버 응답에서 모델 목록을 파싱한다', async () => {
    const srv = await mockJsonServer({
      '/api/tags': {
        models: [
          { name: 'llama3.2:latest', model: 'llama3.2:latest', size: 2019393189 },
          { name: 'qwen2.5-coder:7b', model: 'qwen2.5-coder:7b', size: 4683087332 },
          { size: 1 },
        ],
      },
    });
    try {
      const r = await probeOllama({ baseUrl: srv.url });
      expect(r).toEqual({
        name: 'ollama',
        baseUrl: srv.url,
        api: 'ollama',
        models: ['llama3.2:latest', 'qwen2.5-coder:7b'],
      });
      expect(srv.hits).toEqual(['GET /api/tags']);
    } finally {
      await srv.close();
    }
  });

  it('형식이 다르거나 404·닫힌 포트면 null', async () => {
    const srv = await mockJsonServer({ '/api/tags': { nope: true } });
    try {
      expect(await probeOllama({ baseUrl: srv.url })).toBeNull();
      expect(await probeOllama({ baseUrl: srv.url + '/x' })).toBeNull();
    } finally {
      await srv.close();
    }
    expect(await probeOllama({ baseUrl: `http://127.0.0.1:${await closedPort()}` })).toBeNull();
  });
});
