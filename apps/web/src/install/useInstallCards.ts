import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InstallApi } from './api.js';
import { isPlan } from './api.js';
import type { CandidateView, InstallPlanView, ResolveResultView } from './model.js';

/**
 * 설치 카드 묶음 (T-100 P2-C.7·D.8·G.4·G.5)
 *  - 화면(설치 관리 찾기·주소로 설치·지우기)에서 만든 계획
 *  - 채팅: AI가 MCP 도구 install.plan / install.resolve를 부른 결과 (tool_call + tool_result 이벤트)
 * 카드는 승인 카드 영역(ApprovalsArea)에 함께 뜬다. 실행은 카드의 [설치]를 사람이 누를 때만.
 */

export type InstallCardEntry =
  | { id: string; type: 'plan'; plan: InstallPlanView; sessionId?: string }
  | { id: string; type: 'fail'; result: ResolveResultView; sessionId?: string };

/** 카드 요약 (토스트·탭 제목·사이드바 배지 — useApprovals extra) */
export interface ExtraPending {
  id: string;
  sessionId?: string;
  text: string;
}

const PLAN_TOOL = /(^|[._-])install[._-]plan$/;
const RESOLVE_TOOL = /(^|[._-])install[._-]resolve$/;

/** MCP 도구 결과 → 값 (structuredContent / content[0].text JSON / 문자열 JSON / 그대로) */
export function toolOutputValue(output: unknown): unknown {
  let v = output;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  if (v && typeof v === 'object') {
    const o = v as { structuredContent?: unknown; content?: unknown };
    if (o.structuredContent && typeof o.structuredContent === 'object') return o.structuredContent;
    if (Array.isArray(o.content)) {
      const t = (o.content as { type?: string; text?: unknown }[]).find((c) => typeof c.text === 'string');
      if (t) return toolOutputValue(t.text);
    }
  }
  return v;
}

const looksLikePlan = (v: unknown): v is InstallPlanView =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as InstallPlanView).id === 'string' &&
  typeof (v as InstallPlanView).kind === 'string' &&
  typeof (v as InstallPlanView).target === 'string';

const looksLikeResolve = (v: unknown): v is ResolveResultView =>
  !!v && typeof v === 'object' && typeof (v as ResolveResultView).input === 'string';

export interface ChatInstallCall {
  callId: string;
  tool: 'plan' | 'resolve';
  value: unknown;
  sessionId?: string;
}

/** 이벤트 → AI가 부른 설치 도구 결과 (성공한 것만, 순서대로) */
export function chatInstallCalls(events: readonly unknown[]): ChatInstallCall[] {
  const tools = new Map<string, 'plan' | 'resolve'>();
  const out: ChatInstallCall[] = [];
  for (const e of events) {
    const r = e as {
      type?: string;
      callId?: string;
      tool?: string;
      ok?: boolean;
      output?: unknown;
      sessionId?: string;
    };
    if (r.type === 'tool_call' && r.callId && typeof r.tool === 'string') {
      if (PLAN_TOOL.test(r.tool)) tools.set(r.callId, 'plan');
      else if (RESOLVE_TOOL.test(r.tool)) tools.set(r.callId, 'resolve');
    } else if (r.type === 'tool_result' && r.callId && r.ok !== false) {
      const tool = tools.get(r.callId);
      if (tool)
        out.push({
          callId: r.callId,
          tool,
          value: toolOutputValue(r.output),
          ...(r.sessionId ? { sessionId: r.sessionId } : {}),
        });
    }
  }
  return out;
}

export interface UseInstallCardsOptions {
  events: readonly unknown[];
  api?: Pick<InstallApi, 'getPlan' | 'plan'>;
}

export function useInstallCards({ events, api }: UseInstallCardsOptions) {
  const [cards, setCards] = useState<InstallCardEntry[]>([]);
  const seen = useRef(new Set<string>());

  const put = useCallback((c: InstallCardEntry) => {
    setCards((cs) => (cs.some((x) => x.id === c.id) ? cs : [...cs, c]));
  }, []);
  const add = useCallback(
    (plan: InstallPlanView, sessionId?: string) =>
      put({ id: plan.id, type: 'plan', plan, ...(sessionId ? { sessionId } : {}) }),
    [put],
  );
  const addFailure = useCallback(
    (result: ResolveResultView, sessionId?: string) =>
      put({
        id: `resolve-fail:${result.input}`,
        type: 'fail',
        result,
        ...(sessionId ? { sessionId } : {}),
      }),
    [put],
  );
  const remove = useCallback((id: string) => setCards((cs) => cs.filter((c) => c.id !== id)), []);

  /** 후보 → 계획 카드 (계획은 실행이 아니다) */
  const planCandidate = useCallback(
    async (c: CandidateView, sessionId?: string) => {
      if (!api) return undefined;
      const r = await api.plan({ kind: c.kind, target: c.target });
      const plan = isPlan(r) ? r : r.bootstrap;
      if (plan) add(plan, sessionId);
      return r;
    },
    [api, add],
  );

  // C.7·G.5 채팅: AI의 install.plan / install.resolve 결과 → 카드
  useEffect(() => {
    if (!api) return;
    for (const call of chatInstallCalls(events)) {
      if (seen.current.has(call.callId)) continue;
      seen.current.add(call.callId);
      const sid = call.sessionId;
      if (call.tool === 'plan' && looksLikePlan(call.value)) {
        const p = call.value;
        // 엔진이 따로 띄운 MCP 서버의 계획일 수 있다 → 이 서버에 없으면 같은 대상으로 다시 계획한다
        void api
          .getPlan(p.id)
          .then((plan) => add(plan, sid))
          .catch(() =>
            api
              .plan({ kind: p.kind, target: { id: p.target, ...(p.version ? { version: p.version } : {}) } })
              .then((r) => (isPlan(r) ? add(r, sid) : r.bootstrap && add(r.bootstrap, sid))),
          )
          .catch(() => {});
      } else if (call.tool === 'resolve' && looksLikeResolve(call.value)) {
        const r = call.value;
        if (r.failure || !r.candidates?.length) addFailure(r, sid);
        else {
          const pick = r.recommended ?? r.candidates[0]!;
          void planCandidate(pick, sid).catch(() => {});
        }
      }
    }
  }, [events, api, add, addFailure, planCandidate]);

  const summaries = useMemo<ExtraPending[]>(
    () =>
      cards.map((c) => ({
        id: c.id,
        ...(c.sessionId ? { sessionId: c.sessionId } : {}),
        text:
          c.type === 'plan'
            ? `"${c.plan.name}" 설치 계획을 확인해 주세요.`
            : '주소에서 설치 방법을 찾지 못했어요.',
      })),
    [cards],
  );

  return { cards, add, addFailure, remove, planCandidate, summaries };
}

export type InstallCardsState = ReturnType<typeof useInstallCards>;
