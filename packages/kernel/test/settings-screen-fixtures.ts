import { join } from 'node:path';
import type { SettingsApiOptions } from '../src/api/settings-routes.js';
import { bootApi } from './api-fixtures.js';
import { tempDir } from './helpers.js';

/** T-101 6번 설정 화면 API 테스트 공용: 실제 서버(startApiServer) + 임시 settings.json + 메모리 키체인 */
export async function bootSettings(extra: Partial<SettingsApiOptions> = {}) {
  const tmp = tempDir('hx-settings-screen-');
  const file = join(tmp.dir, 'settings.json');
  const kc = new Map<string, string>();
  const api = await bootApi({
    settings: {
      file,
      secrets: {
        get: (a) => kc.get(a) ?? null,
        set: (a, v) => void kc.set(a, v),
        delete: (a) => kc.delete(a),
      },
      engines: () => ({ codex: { mode: 'apiKey', fallback: [] } }),
      ...extra,
    },
  });
  const req = (method: string, path: string, body?: unknown) =>
    fetch(api.server.url + path, {
      method,
      headers: { ...api.auth, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).then(async (r) => ({
      status: r.status,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 응답 모양을 자유롭게 확인
      body: (await r.json()) as Record<string, any>,
    }));
  const close = async () => {
    await api.close();
    tmp.cleanup();
  };
  return { req, close, file, kc, dir: tmp.dir };
}
