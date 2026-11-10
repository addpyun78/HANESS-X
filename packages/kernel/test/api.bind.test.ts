import { describe, expect, it } from 'vitest';
import { assertLoopback, BindRefusedError, DEFAULT_API_PORT } from '../src/api/server.js';
import { bootApi } from './api-fixtures.js';

describe('API 바인딩', () => {
  it('기본 포트 3790, 0.0.0.0 설정 시 기동 거부', async () => {
    expect(DEFAULT_API_PORT).toBe(3790);
    expect(() => assertLoopback('0.0.0.0')).toThrow(BindRefusedError);
    expect(() => assertLoopback('192.168.0.10')).toThrow(BindRefusedError);
    await expect(bootApi({ host: '0.0.0.0' })).rejects.toThrow(/외부 바인딩 금지/);
  });

  it('127.0.0.1 바인딩', async () => {
    const api = await bootApi();
    const addr = api.server.app.server.address();
    expect(typeof addr === 'object' && addr?.address).toBe('127.0.0.1');
    await api.close();
  });
});
