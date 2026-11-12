import type { HarnessApiClient } from '../../api/client.js';

/** T-101 6번 설정 화면의 덧붙임 API (packages/kernel/src/api/settings-routes.ts) */
export interface SettingsExtrasApi {
  /** 6B.11 [지금 정리하기] */
  cleanup(): Promise<{ ok: true; logs: number; attachments: number }>;
  /** 6B.13 */
  about(): Promise<{ version: string; platform: string; node: string; updateCheck: boolean }>;
  updateCheck(): Promise<{
    current: string;
    latest?: string;
    newer?: boolean;
    url?: string;
    message: string;
  }>;
  diagnostics(): Promise<{ file: string; text: string }>;
  /** 6C.3 */
  exportYaml(): Promise<{ file: string; text: string }>;
  importYaml(text: string): Promise<{ ok: true; imported: string[] }>;
}

type Requester = Pick<HarnessApiClient, 'request'>;

export function settingsExtrasApi(c: Requester): SettingsExtrasApi {
  const post = (body?: unknown): RequestInit => ({
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return {
    cleanup: () => c.request('/api/settings/data/cleanup', post()),
    about: () => c.request('/api/settings/about'),
    updateCheck: () => c.request('/api/settings/update-check', post()),
    diagnostics: () => c.request('/api/settings/diagnostics'),
    exportYaml: () => c.request('/api/settings/export'),
    importYaml: (text) => c.request('/api/settings/import', post({ text })),
  };
}

/** 글을 파일로 내려받기 (브라우저) */
export function downloadText(file: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
