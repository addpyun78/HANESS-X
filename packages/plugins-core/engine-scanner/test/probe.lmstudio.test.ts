import { describe, expect, it } from 'vitest';
import { LMSTUDIO_PROBE, probeLmStudio } from '@harness-x/engine-scanner';
import { mockJsonServer } from './mock-server.js';

describe('12.2 LM Studio GET :1234/v1/models', () => {
  it('기본 대상은 :1234/v1/models (OpenAI 호환)', () => {
    expect(LMSTUDIO_PROBE).toMatchObject({ name: 'lmstudio', port: 1234, path: '/v1/models', api: 'openai' });
  });

  it('모킹 서버의 data[].id 를 모델 목록으로', async () => {
    const srv = await mockJsonServer({
      '/v1/models': {
        object: 'list',
        data: [
          { id: 'qwen2.5-7b-instruct', object: 'model', owned_by: 'organization_owner' },
          { id: 'text-embedding-nomic-embed-text-v1.5', object: 'model', owned_by: 'organization_owner' },
        ],
      },
    });
    try {
      expect(await probeLmStudio({ baseUrl: srv.url + '/' })).toEqual({
        name: 'lmstudio',
        baseUrl: srv.url,
        api: 'openai',
        models: ['qwen2.5-7b-instruct', 'text-embedding-nomic-embed-text-v1.5'],
      });
      expect(srv.hits).toEqual(['GET /v1/models']);
    } finally {
      await srv.close();
    }
  });
});
