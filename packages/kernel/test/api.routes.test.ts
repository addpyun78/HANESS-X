import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startApiServer } from '../src/api/server.js';
import { setup } from './plugin-fixtures.js';

// 통합: startApiServer({ routes }) — engine-scanner의 POST /api/engines/rescan 같은 추가 라우트 (토큰 필요)
describe('api extra routes', () => {
  it('listen 전에 등록되고 토큰 검사를 받는다', async () => {
    const env = setup();
    const loader = env.mk();
    let scans = 0;
    const server = await startApiServer({
      loader,
      log: env.log,
      port: 0,
      tokenFile: join(env.home, 'run', 'token'),
      routes: (app) => {
        app.post('/api/engines/rescan', async () => ({ ok: true, n: ++scans }));
      },
    });
    try {
      const url = server.url + '/api/engines/rescan';
      expect((await fetch(url, { method: 'POST' })).status).toBe(401);
      const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${server.token}` } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, n: 1 });
    } finally {
      await server.close();
      env.cleanup();
    }
  });
});
