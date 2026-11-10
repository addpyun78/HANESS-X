import { act, render } from '@testing-library/react';
import type { EnginesApi } from '../src/settings/Engines/api.js';
import { EnginesSettings } from '../src/settings/Engines/EnginesSettings.js';
import type { EnginesResponse } from '../src/settings/Engines/model.js';

/** T-038 설정 > 엔진 테스트 공용: 가짜 /api/engines 응답과 API */
export const RESPONSE: EnginesResponse = {
  scan: {
    scannedAt: '2026-11-10T09:30:00.000Z',
    platform: 'win32',
    engines: [
      { name: 'codex', location: 'windows', path: 'C:\\npm\\codex.cmd', version: '0.80.0', status: 'ok' },
      {
        name: 'claude',
        location: 'wsl:Ubuntu',
        path: '/usr/local/bin/claude',
        version: '2.1.3',
        status: 'ok',
      },
      {
        name: 'claude',
        location: 'windows',
        path: 'C:\\npm\\claude.cmd',
        version: '2.0.1',
        status: 'outdated',
      },
    ],
  },
  settings: { engines: { codex: { mode: 'apiKey', model: 'gpt-5-codex', fallback: ['claude-code'] } } },
  keys: { codex: { masked: '••••9xyz' }, 'claude-code': null },
};

export function fakeApi(over: Partial<EnginesApi> = {}) {
  const calls: unknown[][] = [];
  let resp = structuredClone(RESPONSE);
  const api: EnginesApi = {
    list: async () => structuredClone(resp),
    rescan: async () => {
      calls.push(['rescan']);
      resp = {
        ...resp,
        scan: {
          ...resp.scan!,
          scannedAt: '2026-11-10T10:00:00.000Z',
          engines: [
            ...resp.scan!.engines,
            { name: 'agy', location: 'windows', path: 'C:\\agy.exe', version: '1.0.0', status: 'ok' },
          ],
        },
      };
      return { ok: true };
    },
    login: async (id) => ({ engine: id, state: id === 'codex' ? 'loggedIn' : 'unknown' }),
    saveSettings: async (id, patch) => void calls.push(['settings', id, patch]),
    saveKey: async (id, key) => {
      calls.push(['key', id, key.length]);
      return { key: { masked: `••••${key.slice(-4)}` } };
    },
    deleteKey: async () => undefined,
    ping: async (id) => ({ ok: true, engineId: id, text: 'pong', latencyMs: 812 }),
    ...over,
  };
  return { api, calls };
}

export async function mount(api: EnginesApi) {
  const r = render(<EnginesSettings api={api} />);
  await act(async () => {});
  return r;
}
