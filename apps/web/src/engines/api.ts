import type { MainAi, ModelsResponse } from '@harness-x/protocol';
import type { HarnessApiClient } from '../api/client.js';
import type { AiChoice, ScanProgressView } from './model.js';

/** 재스캔 시점 (5A.9): 설치 관리에서 설치 완료 · 설정 [다시 찾기] (시작·30분마다는 서버가 스스로) */
export type RescanReason = 'install' | 'manual';

/** 커널 /api/engines/scan-status · /api/engines/rescan · /api/models · /api/main-ai · /api/sessions/:id/ai */
export interface EngineScanApi {
  scanStatus(): Promise<ScanProgressView>;
  rescan(reason: RescanReason): Promise<unknown>;
  models(): Promise<ModelsResponse>;
  mainAi(): Promise<{ main: MainAi | null }>;
  setMainAi(c: AiChoice): Promise<unknown>;
  setSessionAi(sessionId: string, c: AiChoice): Promise<unknown>;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export function engineScanApi(c: Pick<HarnessApiClient, 'request'>): EngineScanApi {
  return {
    scanStatus: () => c.request('/api/engines/scan-status'),
    rescan: (reason) => c.request('/api/engines/rescan', json('POST', { reason })),
    models: () => c.request('/api/models'),
    mainAi: () => c.request('/api/main-ai'),
    setMainAi: (x) => c.request('/api/main-ai', json('PUT', x)),
    setSessionAi: (id, x) => c.request(`/api/sessions/${encodeURIComponent(id)}/ai`, json('PUT', x)),
  };
}
