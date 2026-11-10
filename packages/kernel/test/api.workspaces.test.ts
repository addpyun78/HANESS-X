import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceStore } from '../src/workspaces.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

interface J {
  current?: { path: string };
  recent: { pinned?: boolean }[];
  cwd?: string;
  workspace?: unknown;
  error?: string;
}
const json = async (r: Response | Promise<Response>) => (await (await r).json()) as J;

describe('워크스페이스 API', () => {
  it('open → 검증·등록(workspaces.json) → GET 현재·최근·cwd, 거부는 400, 핀', async () => {
    const t = tempDir('hx-apiws-');
    const store = new WorkspaceStore({ file: join(t.dir, 'home', 'workspaces.json') });
    const api = await bootApi({ server: { workspaces: store } });
    const dir = join(t.dir, 'proj-a');
    mkdirSync(dir, { recursive: true });
    try {
      const empty = await json(api.get('/api/workspaces', api.auth));
      expect(empty).toMatchObject({ recent: [] });
      expect(empty.current).toBeUndefined();

      const res = await api.post('/api/workspaces/open', { path: dir }, api.auth);
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.workspace).toMatchObject({ name: 'proj-a', path: realpathSync(dir), git: false });
      expect(JSON.parse(readFileSync(store.file, 'utf8')).current).toBe(realpathSync(dir));

      const cur = await json(api.get('/api/workspaces', api.auth));
      expect(cur.current?.path).toBe(realpathSync(dir));
      expect(cur.cwd).toBe(realpathSync(dir));
      expect(cur.recent).toHaveLength(1);

      const bad = await api.post('/api/workspaces/open', { path: '/etc' }, api.auth);
      expect(bad.status).toBe(400);
      expect(await json(bad)).toMatchObject({ error: 'system_dir' });
      const none = await api.post('/api/workspaces/open', {}, api.auth);
      expect(none.status).toBe(400);

      const pin = await api.post('/api/workspaces/pin', { path: realpathSync(dir), pinned: true }, api.auth);
      expect((await json(pin)).recent[0]).toMatchObject({ pinned: true });
      expect((await api.post('/api/workspaces/pin', { path: '/nope', pinned: true }, api.auth)).status).toBe(
        404,
      );
    } finally {
      await api.close();
      t.cleanup();
    }
  });
});
