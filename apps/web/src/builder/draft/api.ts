import type { AgentDraft, DraftChange, DraftQuestion } from '@harness-x/protocol';
import type { HarnessApiClient } from '../../api/client.js';

/**
 * 대화로 만들기 — 서버 API (agent-builder designer/route.ts)
 * 웹은 설계 AI를 직접 부르지 않는다. 저장은 사람 클릭 토큰이 있어야 한다(P4-F.2).
 */

export interface EngineSuggestion {
  nodeId: string;
  engine: string;
  suggest?: string;
  health: string;
  message: string;
}

export interface DesignNotice {
  source: string;
  message: string;
  nodeId?: string;
}

export type DesignResponse =
  | { kind: 'questions'; questions: DraftQuestion[] }
  | {
      kind: 'draft';
      draftId: string;
      version: number;
      draft: AgentDraft;
      notices: DesignNotice[];
      engineSuggestions: EngineSuggestion[];
      designEngine?: string;
    }
  | { kind: 'failed'; message: string };

export type EditResponse =
  | { ok: true; draft: AgentDraft; changes: DraftChange[]; patch: unknown[] }
  | { ok: false; message: string; reasons: string[] };

export interface DraftVersionInfo {
  v: number;
  at: string;
  source: 'ai' | 'ai-patch' | 'canvas' | 'yaml' | 'revert';
  note?: string;
  draft: AgentDraft;
}

export interface DraftRecordInfo {
  id: string;
  request: string;
  createdAt: string;
  updatedAt: string;
  designEngine?: string;
  conversation: { role: 'user' | 'ai'; text: string }[];
  versions: DraftVersionInfo[];
  working?: AgentDraft;
}

export interface DraftListItem {
  id: string;
  displayName: string;
  request: string;
  updatedAt: string;
  versions: number;
  gaps: number;
  stale: boolean;
}

export interface SaveDraftRequest {
  draftId: string;
  draft: AgentDraft;
  /** 빈 칸이 있어도 저장 (실행은 막힌다) */
  allowIncomplete?: boolean;
}

export interface SaveDraftResponse {
  name: string;
  command: string;
  dir: string;
  files: string[];
  status: 'ready' | 'incomplete';
}

export type SaveDraftError =
  | { error: 'name_taken'; message: string; suggestion: { name: string; command: string } }
  | { error: string; message: string };

export interface DesignerApi {
  design(req: {
    request: string;
    skipQuestions?: boolean;
    answers?: { question: string; answer: string }[];
  }): Promise<DesignResponse>;
  edit(req: { draft: AgentDraft; instruction: string }): Promise<EditResponse>;
  listDrafts(): Promise<DraftListItem[]>;
  getDraft(id: string): Promise<DraftRecordInfo>;
  /** version: true면 새 버전, 아니면 자동 보관(working) */
  putDraft(
    id: string,
    body: { draft: AgentDraft; version?: boolean; source?: DraftVersionInfo['source']; note?: string },
  ): Promise<DraftRecordInfo>;
  revertDraft(id: string, v: number): Promise<DraftRecordInfo>;
  deleteDraft(id: string): Promise<void>;
  /** P4-F.2 사람 클릭 토큰 (저장 버튼을 누를 때만 받는다) */
  gestureToken(kind: 'save-agent'): Promise<string>;
  saveAgent(body: SaveDraftRequest, gestureToken: string): Promise<SaveDraftResponse>;
}

export function httpDesignerApi(c: HarnessApiClient): DesignerApi {
  const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers,
  });
  return {
    design: (req) => c.request('/api/builder/design', json('POST', req)),
    edit: (req) => c.request('/api/builder/edit', json('POST', req)),
    listDrafts: () => c.request<{ drafts: DraftListItem[] }>('/api/builder/drafts').then((r) => r.drafts),
    getDraft: (id) => c.request(`/api/builder/drafts/${encodeURIComponent(id)}`),
    putDraft: (id, body) => c.request(`/api/builder/drafts/${encodeURIComponent(id)}`, json('PUT', body)),
    revertDraft: (id, v) =>
      c.request(`/api/builder/drafts/${encodeURIComponent(id)}/revert`, json('POST', { version: v })),
    deleteDraft: (id) => c.request(`/api/builder/drafts/${encodeURIComponent(id)}`, json('DELETE')),
    gestureToken: (kind) =>
      c.request<{ token: string }>('/api/gesture-tokens', json('POST', { kind })).then((r) => r.token),
    saveAgent: (body, token) =>
      c.request('/api/agents/save', json('POST', body, { 'x-harness-gesture': token })),
  };
}
