import { readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { bootApi } from './api-fixtures.js';

describe('세션 토큰', () => {
  it('토큰 없는 요청 401, 토큰 파일 권한 600, 실행마다 다른 토큰', async () => {
    const api = await bootApi();
    const t1 = api.server.token;
    expect(readFileSync(api.server.tokenFile, 'utf8').trim()).toBe(t1);
    if (process.platform !== 'win32') expect(statSync(api.server.tokenFile).mode & 0o777).toBe(0o600);
    expect((await api.get('/api/plugins')).status).toBe(401);
    expect((await api.get('/api/plugins', { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await api.get('/api/plugins', api.auth)).status).toBe(200);
    expect((await api.get('/api/plugins', { 'x-harness-token': t1 })).status).toBe(200);
    // Host 헤더 위조(DNS 리바인딩) 차단
    const status = await new Promise<number>((res, rej) => {
      const r = request(
        {
          host: '127.0.0.1',
          port: api.server.port,
          path: '/api/health',
          headers: { ...api.auth, host: 'evil.example' },
        },
        (resp) => {
          resp.resume();
          res(resp.statusCode ?? 0);
        },
      );
      r.on('error', rej);
      r.end();
    });
    expect(status).toBe(403);
    await api.close();
    const api2 = await bootApi();
    expect(api2.server.token).not.toBe(t1);
    await api2.close();
  });
});
