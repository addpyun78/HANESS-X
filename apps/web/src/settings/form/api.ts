import type { ReactNode } from 'react';
import type { HarnessApiClient, PickFolderResponse } from '../../api/client.js';
import type { ResetTarget, SaveResponse, SaveScope, SettingsResponse, SettingValueState } from './types.js';

/** 커널 /api/settings… 라우트 (packages/kernel/src/api/settings-routes.ts) */
export interface SettingsApi {
  load(project?: string): Promise<SettingsResponse>;
  save(key: string, value: unknown, scope?: SaveScope, project?: string): Promise<SaveResponse>;
  reset(
    target: ResetTarget,
    scope?: SaveScope,
    project?: string,
  ): Promise<{ ok: true; reset: string[]; values: Record<string, SettingValueState> }>;
  saveSecret(key: string, value: string): Promise<{ masked: string }>;
  deleteSecret(key: string): Promise<unknown>;
}

type Requester = Pick<HarnessApiClient, 'request'>;

export function settingsApi(c: Requester): SettingsApi {
  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const q = encodeURIComponent;
  return {
    load: (project) => c.request(`/api/settings${project ? `?project=${q(project)}` : ''}`),
    save: (key, value, scope, project) =>
      c.request('/api/settings', json('PUT', { key, value, scope, ...(project ? { project } : {}) })),
    reset: (target, scope, project) =>
      c.request('/api/settings/reset', json('POST', { ...target, scope, ...(project ? { project } : {}) })),
    saveSecret: (key, value) => c.request('/api/settings/secret', json('PUT', { key, value })),
    deleteSecret: (key) => c.request(`/api/settings/secret?key=${q(key)}`, json('DELETE')),
  };
}

/** 맞춤 위젯이 쓰는 주입 함수들 */
export interface SettingsWidgetContext {
  /** 엔진·모델 선택기: 지금 있는 엔진 목록 (GET /api/engines의 adapters) */
  listEngines?: () => Promise<{ id: string; displayName?: string }[]>;
  /** 5번에서 확장: 엔진별 모델 목록 (없으면 직접 입력만) */
  listModels?: (engineId: string) => Promise<string[]>;
  /** 폴더 선택기 (T-034: client.pickFolder / pickFolderDesktop) */
  pickFolder?: (initialPath?: string) => Promise<PickFolderResponse>;
  /** 키 입력기 저장·지우기 (SettingsForm이 api로 채운다) */
  saveSecret?: (key: string, value: string) => Promise<{ masked: string }>;
  deleteSecret?: (key: string) => Promise<unknown>;
  /** 엔진별 설정 묶음 화면 (설정 > 엔진). 없으면 안내 글만 */
  renderEngineSettings?: () => ReactNode;
}

/** 서버 오류 → 쉬운 말 (서버가 준 message가 있으면 그것) */
export function errorMessage(e: unknown): string {
  const body = (e as { body?: { message?: unknown } } | null)?.body;
  if (body && typeof body.message === 'string') return body.message;
  return '저장하지 못했어요. 잠시 뒤 다시 해 주세요.';
}
