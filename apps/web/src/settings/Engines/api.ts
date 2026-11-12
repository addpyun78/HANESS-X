import type { HarnessApiClient } from '../../api/client.js';
import type { AuthMode, EnginesResponse, LoginState, PingResult } from './model.js';

/** 커널 /api/engines… 라우트 (packages/kernel/src/api/engines-routes.ts) */
export interface EnginesApi {
  list(): Promise<EnginesResponse>;
  rescan(): Promise<unknown>;
  login(id: string): Promise<{ engine: string; state: LoginState; method?: string; plan?: string }>;
  saveSettings(
    id: string,
    patch: { mode?: AuthMode; model?: string | null; fallback?: string[] },
  ): Promise<unknown>;
  saveKey(id: string, key: string): Promise<{ key: { masked: string } }>;
  deleteKey(id: string): Promise<unknown>;
  ping(id: string): Promise<PingResult>;
}

type Requester = Pick<HarnessApiClient, 'request'>;

const enc = encodeURIComponent;

export function enginesApi(c: Requester): EnginesApi {
  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return {
    list: () => c.request('/api/engines'),
    // T-101 5A.9 설정 [다시 찾기] = 재스캔 시점 manual
    rescan: () => c.request('/api/engines/rescan', json('POST', { reason: 'manual' })),
    login: (id) => c.request(`/api/engines/${enc(id)}/login`),
    saveSettings: (id, patch) => c.request(`/api/engines/${enc(id)}/settings`, json('PUT', patch)),
    saveKey: (id, key) => c.request(`/api/engines/${enc(id)}/key`, json('PUT', { key })),
    deleteKey: (id) => c.request(`/api/engines/${enc(id)}/key`, json('DELETE')),
    ping: (id) => c.request(`/api/engines/${enc(id)}/ping`, json('POST')),
  };
}
