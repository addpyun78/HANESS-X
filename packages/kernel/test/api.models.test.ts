import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelsResponseSchema } from '@harness-x/protocol';
import { readMainAi, SessionAiOverrides } from '../src/main-ai.js';
import { ModelCatalog, type ModelScanLike } from '../src/models.js';
import { registerModelRoutes } from '../src/api/models-routes.js';

const scan: ModelScanLike = {
  scannedAt: '2026-11-12T00:00:00.000Z',
  engines: [{ name: 'claude', status: 'ok', version: '2.1.3' }],
  localLlms: [{ name: 'ollama', baseUrl: 'http://127.0.0.1:11434', api: 'ollama', models: ['llama3'] }],
};

describe('T-101 5B.4 GET /api/models · 메인 AI API', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-models-api-'));
    dirs.push(dir);
    const app = Fastify();
    const sessions = new SessionAiOverrides();
    registerModelRoutes(app, {
      catalog: new ModelCatalog({ scan: () => scan, cacheFile: join(dir, 'models.json') }),
      settingsFile: join(dir, 'settings.json'),
      sessions,
    });
    return { app, dir, sessions };
  };

  it('응답이 ModelsResponse 스키마와 맞다', async () => {
    const { app } = setup();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/models' });
      expect(res.statusCode).toBe(200);
      const body = ModelsResponseSchema.parse(res.json());
      expect(body.scannedAt).toBe(scan.scannedAt);
      expect(body.models.map((m) => `${m.engineId}/${m.modelId}`)).toEqual([
        'claude-code/sonnet',
        'claude-code/opus',
        'claude-code/haiku',
        'ollama/llama3',
      ]);
    } finally {
      await app.close();
    }
  });

  it('PUT /api/main-ai → settings.json main.* (다른 설정 유지), 잘못된 값은 400', async () => {
    const { app, dir } = setup();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ judge: { engine: '' } }));
    try {
      expect((await app.inject({ method: 'GET', url: '/api/main-ai' })).json()).toEqual({ main: null });
      const put = await app.inject({
        method: 'PUT',
        url: '/api/main-ai',
        payload: { engine: 'codex', model: 'gpt-5.5' },
      });
      expect(put.json()).toEqual({ ok: true, main: { engine: 'codex', model: 'gpt-5.5' } });
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
        judge: { engine: '' },
        main: { engine: 'codex', model: 'gpt-5.5' },
      });
      expect(readMainAi(file)).toEqual({ engine: 'codex', model: 'gpt-5.5' });
      expect(
        (await app.inject({ method: 'PUT', url: '/api/main-ai', payload: { engine: '../x' } })).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});
