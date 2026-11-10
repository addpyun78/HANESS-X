import { describe, expect, it, vi } from 'vitest';
import type { PickFolderOptions, PickFolderResult } from '../src/native/folder-picker.js';
import { bootApi } from './api-fixtures.js';

describe('POST /api/native/pick-folder (피커 모킹)', () => {
  it('선택 경로 반환, initialPath 전달, 토큰 필요', async () => {
    const pick = vi.fn(async (_o?: PickFolderOptions): Promise<PickFolderResult> => ({
      path: '/mnt/c/work/app',
    }));
    const api = await bootApi({ server: { folderPicker: { pick } } });
    try {
      expect((await api.post('/api/native/pick-folder', {})).status).toBe(401);
      expect(pick).not.toHaveBeenCalled();

      const res = await api.post('/api/native/pick-folder', { initialPath: '/mnt/c/work' }, api.auth);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ cancelled: false, path: '/mnt/c/work/app' });
      expect(pick).toHaveBeenLastCalledWith({ initialPath: '/mnt/c/work' });

      await api.post('/api/native/pick-folder', {}, api.auth);
      expect(pick).toHaveBeenLastCalledWith({});
    } finally {
      await api.close();
    }
  });

  it('피커 오류 → 500 picker_failed', async () => {
    const api = await bootApi({
      server: { folderPicker: { pick: () => Promise.reject(new Error('boom')) } },
    });
    try {
      const res = await api.post('/api/native/pick-folder', {}, api.auth);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'picker_failed', message: 'boom' });
    } finally {
      await api.close();
    }
  });

  it('34.6 취소 → 200 {cancelled:true}', async () => {
    const api = await bootApi({ server: { folderPicker: { pick: async () => ({ cancelled: true }) } } });
    try {
      const res = await api.post('/api/native/pick-folder', {}, api.auth);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ cancelled: true });
    } finally {
      await api.close();
    }
  });

  it('34.8 대화상자가 떠 있는 동안 두 번째 요청은 409', async () => {
    let release!: (r: PickFolderResult) => void;
    const pick = vi.fn(
      () =>
        new Promise<PickFolderResult>((r) => {
          release = r;
        }),
    );
    const api = await bootApi({ server: { folderPicker: { pick } } });
    try {
      const first = api.post('/api/native/pick-folder', {}, api.auth);
      await vi.waitFor(() => expect(pick).toHaveBeenCalledOnce());
      const second = await api.post('/api/native/pick-folder', {}, api.auth);
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: 'picker_busy' });
      release({ path: 'C:\\a' });
      expect((await first).status).toBe(200);
      // 끝난 뒤에는 다시 열 수 있다
      const third = api.post('/api/native/pick-folder', {}, api.auth);
      await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(2));
      release({ cancelled: true });
      expect((await third).status).toBe(200);
    } finally {
      await api.close();
    }
  });
});
