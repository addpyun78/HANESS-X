import type { HarnessEvent } from '@harness-x/protocol';

/**
 * 37.4 궤적 모델 — 이벤트를 턴(turn_end) 단위 단계로 묶고 단계별 토큰·비용을 합산한다.
 * 실시간 스트림에서 한 개씩 reduce한 결과와 이벤트 로그를 재생해 만든 결과가 같아야 한다(순수 함수).
 */

export interface TrajectoryEntry {
  id: string;
  ts: string;
  type: HarnessEvent['type'];
  label: string;
  itemId?: string;
}

export interface StepUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface TrajectoryStep {
  index: number;
  startTs: string;
  endTs: string;
  engineIds: string[];
  itemIds: string[];
  entries: TrajectoryEntry[];
  usage: StepUsage;
  /** turn_end 사유 (진행 중이면 없음) */
  endReason?: string;
}

export interface Trajectory {
  steps: TrajectoryStep[];
  totals: StepUsage & { events: number };
  /** 이미 반영한 이벤트 id (중복 수신 무시) */
  seen: string[];
}

const zeroUsage = (): StepUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 });

export const EMPTY_TRAJECTORY: Trajectory = { steps: [], totals: { ...zeroUsage(), events: 0 }, seen: [] };

function labelOf(e: HarnessEvent): string {
  switch (e.type) {
    case 'assistant_text':
      return e.text.length > 60 ? e.text.slice(0, 59) + '…' : e.text;
    case 'tool_call':
      return `도구 ${e.tool}`;
    case 'tool_result':
      return `도구 결과 ${e.ok ? '성공' : '실패'}`;
    case 'file_change':
      return `파일 ${e.change} ${e.path}`;
    case 'usage':
      return `사용량 입력 ${e.inputTokens} · 출력 ${e.outputTokens}`;
    case 'error':
      return `오류 ${e.code}`;
    case 'turn_end':
      return `턴 종료 (${e.reason})`;
    case 'approval_request':
      return `승인 요청 ${e.title}`;
    case 'checklist_change':
      return `항목 ${e.changedItemId}: ${e.from ?? '없음'} → ${e.to}`;
  }
}

const addUnique = (xs: string[], x: string | undefined) => (x && !xs.includes(x) ? [...xs, x] : xs);

/** 이벤트 하나 반영 (불변) */
export function reduceTrajectory(t: Trajectory, e: HarnessEvent): Trajectory {
  if (t.seen.includes(e.id)) return t;
  // 스트리밍 조각(partial)은 최종 텍스트와 중복되므로 단계 기록에서 뺀다
  if (e.type === 'assistant_text' && e.partial) return { ...t, seen: [...t.seen, e.id] };
  const last = t.steps.at(-1);
  const open = last && last.endReason === undefined ? last : undefined;
  const step: TrajectoryStep = open
    ? { ...open, entries: [...open.entries], usage: { ...open.usage } }
    : {
        index: t.steps.length,
        startTs: e.ts,
        endTs: e.ts,
        engineIds: [],
        itemIds: [],
        entries: [],
        usage: zeroUsage(),
      };
  step.endTs = e.ts;
  step.engineIds = addUnique(step.engineIds, e.engineId);
  step.itemIds = addUnique(step.itemIds, e.itemId);
  step.entries.push({
    id: e.id,
    ts: e.ts,
    type: e.type,
    label: labelOf(e),
    ...(e.itemId ? { itemId: e.itemId } : {}),
  });
  const totals = { ...t.totals, events: t.totals.events + 1 };
  if (e.type === 'usage') {
    const cache = e.cacheReadTokens ?? 0;
    const cost = e.costUsd ?? 0;
    step.usage.inputTokens += e.inputTokens;
    step.usage.outputTokens += e.outputTokens;
    step.usage.cacheReadTokens += cache;
    step.usage.costUsd += cost;
    totals.inputTokens += e.inputTokens;
    totals.outputTokens += e.outputTokens;
    totals.cacheReadTokens += cache;
    totals.costUsd += cost;
  }
  if (e.type === 'turn_end') step.endReason = e.reason;
  const steps = open ? [...t.steps.slice(0, -1), step] : [...t.steps, step];
  return { steps, totals, seen: [...t.seen, e.id] };
}

export function buildTrajectory(events: Iterable<HarnessEvent>): Trajectory {
  let t = EMPTY_TRAJECTORY;
  for (const e of events) t = reduceTrajectory(t, e);
  return t;
}
