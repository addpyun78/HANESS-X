import type { HarnessApiClient } from '../api/client.js';
import type {
  CandidateView,
  InstallKind,
  InstallLogRecordView,
  InstallPlanView,
  PlanAction,
  ResolveResultView,
  ToolEntryView,
} from './model.js';

/** 사람 클릭 토큰 헤더 (kernel human-gesture-token.ts GESTURE_TOKEN_HEADER) */
export const GESTURE_HEADER = 'x-harness-gesture';

export type GestureKind = 'install' | 'uninstall' | 'update' | 'rollback' | 'import';

/** POST /api/install/plan 응답: 계획 또는 "설치 도구가 없어요" */
export type PlanResponse =
  InstallPlanView | { unavailable: true; kind: InstallKind; missing: string[]; bootstrap?: InstallPlanView };

export interface InstallJobView {
  id: string;
  planId: string;
  action: PlanAction;
  status: string;
  message?: string;
  warnings?: string[];
  failure?: { title: string; message: string; cleanup: string[]; canCleanup: boolean; details: string };
  toolId?: string;
}

/**
 * 커널 설치 관리자 API (kernel api/install-routes.ts)
 * 실행·제거·업데이트·가져오기는 화면의 실제 클릭 처리기 안에서만 부른다:
 * 먼저 POST /api/gesture-tokens {kind}로 1회용 토큰을 받고, 그 토큰을 헤더에 실어 보낸다.
 */
export interface InstallApi {
  search(query: string, kind?: string): Promise<{ query: string; candidates: CandidateView[] }>;
  resolve(url: string): Promise<ResolveResultView>;
  plan(req: { kind: InstallKind; target: CandidateView['target'] }): Promise<PlanResponse>;
  getPlan(planId: string): Promise<InstallPlanView>;
  /** 클릭 처리기 전용: 토큰 받기 → 실행 */
  execute(planId: string, action: PlanAction): Promise<InstallJobView>;
  cancel(jobId: string): Promise<unknown>;
  uninstallPlan(toolId: string): Promise<InstallPlanView>;
  updates(): Promise<{ checkedAt: string; skipped: boolean; updates: InstallPlanView[] }>;
  tools(): Promise<{ tools: ToolEntryView[] }>;
  history(): Promise<{ records: InstallLogRecordView[] }>;
  /** P2-F.6 새 도구 첫 실행 카드 버튼 (once 이번만 · always 앞으로 · deny 허락 안 함) */
  firstRunAnswer?(id: string, choice: 'once' | 'always' | 'deny'): Promise<unknown>;
}

export function installApi(c: Pick<HarnessApiClient, 'request'>): InstallApi {
  const post = <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    c.request<T>(path, { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers } : {}) });
  const gesture = async (kind: GestureKind) =>
    (await post<{ token: string }>('/api/gesture-tokens', { kind })).token;
  return {
    search: (query, kind) => post('/api/install/search', { query, ...(kind ? { kind } : {}) }),
    resolve: (url) => post('/api/install/resolve', { url }),
    plan: (req) => post('/api/install/plan', req),
    getPlan: (planId) => c.request(`/api/install/plans/${encodeURIComponent(planId)}`),
    execute: async (planId, action) => {
      const token = await gesture(action);
      return post('/api/install/execute', { planId }, { [GESTURE_HEADER]: token });
    },
    cancel: (jobId) => post('/api/install/cancel', { jobId }),
    uninstallPlan: (toolId) => post('/api/install/uninstall-plan', { toolId }),
    updates: () => post('/api/install/updates', {}),
    tools: () => c.request('/api/install/tools'),
    history: () => c.request('/api/install/history'),
    firstRunAnswer: (id, choice) => post(`/api/install/first-run/${encodeURIComponent(id)}`, { choice }),
  };
}

export function isPlan(r: PlanResponse): r is InstallPlanView {
  return !('unavailable' in r);
}
