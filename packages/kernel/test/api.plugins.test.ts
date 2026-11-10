import { describe, expect, it } from 'vitest';
import { bootApi } from './api-fixtures.js';

describe('GET /api/plugins', () => {
  it('hello 포함 목록 반환', async () => {
    const api = await bootApi();
    const res = await api.get('/api/plugins', api.auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plugins: { id: string; state: string; slots: string[] }[] };
    expect(body.plugins).toContainEqual(
      expect.objectContaining({ id: 'hello', version: '0.1.0', state: 'active', slots: ['command'] }),
    );
    await api.close();
  });
});
