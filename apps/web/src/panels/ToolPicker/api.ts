import type { HarnessApiClient } from '../../api/client.js';
import { navigate } from '../../router.js';
import type { PickerCandidateData, ToolNeedData, ToolPickerData } from './model.js';

/**
 * 도구 고르기 카드 ↔ 커널 /api/tools/* (kernel api/tool-routes.ts)
 * 설치 실행은 Part 2 계획 카드의 [설치](클릭 토큰)로만 — 여기서는 계획까지만 만든다.
 */

export type FindResultData =
  | { status: 'have'; need: ToolNeedData; tool: { id: string; name: string }; message: string }
  | ({ status: 'candidates' } & Omit<ToolPickerData, 'id'>);

export interface ToolPickerApi {
  find(req: {
    capability: string;
    why?: string;
    itemId?: string;
    nodeId?: string;
    sessionId?: string;
  }): Promise<FindResultData>;
  planSelected(
    need: ToolNeedData,
    candidates: PickerCandidateData[],
  ): Promise<{ plans: { candidateId: string; plan?: unknown; reason?: string }[] }>;
  continueWithout(
    need: ToolNeedData,
    o: { itemId?: string; possible: boolean; alternative?: string; reason?: string },
  ): Promise<{ status: string; instruction?: string; reason?: string }>;
}

export function toolPickerApi(c: Pick<HarnessApiClient, 'request'>): ToolPickerApi {
  const post = <T>(path: string, body: unknown) =>
    c.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  return {
    find: (req) => post('/api/tools/find', req),
    planSelected: (need, candidates) => post('/api/tools/plan-selected', { need, candidates }),
    continueWithout: (need, o) => post('/api/tools/continue', { need, ...o }),
  };
}

let seq = 0;
/** 서버 결과 → 카드 데이터 (카드 id 부여) */
export function toPickerData(r: Extract<FindResultData, { status: 'candidates' }>): ToolPickerData {
  seq += 1;
  return {
    id: `tool-picker-${seq}`,
    need: r.need,
    candidates: r.candidates,
    notices: r.notices,
    ...(r.recommendedId ? { recommendedId: r.recommendedId } : {}),
  };
}

/**
 * P3-C.4 [선택한 걸로 설치]의 기본 동작: 고른 후보마다 계획을 만들고, Part 2 계획 카드를 순서대로 띄운다.
 * showPlanCard는 Part 2 설치 계획 카드 화면이 넘겨준다 (주입).
 */
export async function installSelectedInOrder(
  api: Pick<ToolPickerApi, 'planSelected'>,
  need: ToolNeedData,
  chosen: PickerCandidateData[],
  showPlanCard: (plan: unknown, candidate: PickerCandidateData) => void,
): Promise<{ shown: number; skipped: { candidateId: string; reason: string }[] }> {
  const { plans } = await api.planSelected(need, chosen);
  let shown = 0;
  const skipped: { candidateId: string; reason: string }[] = [];
  for (const c of chosen) {
    const p = plans.find((x) => x.candidateId === c.id);
    if (p?.plan) {
      showPlanCard(p.plan, c);
      shown += 1;
    } else skipped.push({ candidateId: c.id, reason: p?.reason ?? '설치 계획을 만들지 못했어요.' });
  }
  return { shown, skipped };
}

/** Part 2 C(주소로 설치) 화면 경로 */
export const URL_INSTALL_ROUTE = '/install/url';

/** P3-C.5 [주소 직접 넣기]의 기본 동작 */
export function openUrlInstall(nav: (path: string) => void = navigate): void {
  nav(URL_INSTALL_ROUTE);
}

/** Part 4 에이전트 초안의 빈 칸 (빌더 노드) */
export interface AgentGapData {
  nodeId: string;
  capability: string;
  why?: string;
}

/**
 * P3-D.3 빌더 빈 칸의 [도구 찾기] → 도구 고르기 카드.
 * 빌더 GapNode의 onFindTool(gap)에 이 함수를 묶어 넘긴다: onFindTool={(g) => openToolPickerForGap(g, { api, show })}
 * 이미 있는 도구면 카드 대신 onHave로 알린다.
 */
export async function openToolPickerForGap(
  gap: AgentGapData,
  deps: {
    api: Pick<ToolPickerApi, 'find'>;
    show: (card: ToolPickerData) => void;
    onHave?: (r: Extract<FindResultData, { status: 'have' }>) => void;
  },
): Promise<ToolPickerData | undefined> {
  const r = await deps.api.find({
    capability: gap.capability,
    nodeId: gap.nodeId,
    ...(gap.why ? { why: gap.why } : {}),
  });
  if (r.status === 'have') {
    deps.onHave?.(r);
    return undefined;
  }
  const card = toPickerData(r);
  deps.show(card);
  return card;
}
