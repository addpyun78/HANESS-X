import type { HookBus, HookResult } from '@harness-x/kernel';
import { statusOf, type ChecklistStatus, type StopDecisionInput } from '../stop-guard.js';
import type { Stage, StageTree } from './schema.js';
import { isStageSettled } from './state.js';
import { allStages, currentStage, stageChecklist, stageLabel, treeComplete } from './tree.js';

/**
 * 루트 기준 종료 판단 (T-101 4A.6)
 * 모든 단계가 done/skipped일 때만 세션 종료를 허용한다. 단계 1개 트리는 기존 판단(T-028)과 결과가 같다.
 */

export interface StageStopStatus {
  complete: boolean;
  /** 끝나지 않은 단계 */
  remainingStages: { stageId: string; title: string; status: Stage['status'] }[];
  /** 현재 단계의 기존 상태(항목 기준) */
  current: { stageId: string; status: ChecklistStatus } | null;
  progressKey: string;
}

export function stageProgressKey(t: Pick<StageTree, 'stages'>): string {
  return allStages(t)
    .map(
      (s) => `${s.stageId}=${s.status}:` + s.items.map((i) => `${i.status[0]}${i.evidence.length}`).join(''),
    )
    .join(',');
}

export function stageStopStatus(t: StageTree): StageStopStatus {
  const remaining = allStages(t).filter((s) => !isStageSettled(s.status) && s.kind !== 'iteration');
  const settledParents = new Set(
    allStages(t)
      .filter((s) => s.status === 'skipped')
      .map((s) => s.stageId),
  );
  const rest = remaining.filter((s) => ![...settledParents].some((p) => s.stageId.startsWith(`${p}.`)));
  const cur = currentStage(t);
  return {
    complete: treeComplete(t),
    remainingStages: rest.map((s) => ({ stageId: s.stageId, title: s.title, status: s.status })),
    current: cur ? { stageId: cur.stageId, status: statusOf(t.sessionId, stageChecklist(cur)) } : null,
    progressKey: stageProgressKey(t),
  };
}

export type StageStopDecision =
  | { decision: 'allow'; reason: string; status: StageStopStatus }
  | { decision: 'block'; reason: string; status: StageStopStatus };

export function stageStopInstruction(st: StageStopStatus, t: StageTree): string {
  const cur = st.current;
  const left = st.remainingStages.length;
  if (cur?.status.next)
    return isSingleTask(t)
      ? cur.status.next.instruction
      : `${cur.status.next.instruction} (남은 단계 ${left}개)`;
  const s = cur ? allStages(t).find((x) => x.stageId === cur.stageId) : undefined;
  return `${s ? stageLabel(s) : '다음 단계'}가 아직 끝나지 않았어요. 남은 단계 ${left}개 — 멈추지 말고 계속 진행하세요.`;
}

/** 에이전트 없는 세션 (단계 1개 "작업") */
export function isSingleTask(t: Pick<StageTree, 'stages'>): boolean {
  return t.stages.length === 1 && t.stages[0]!.kind === 'task';
}

export function decideStageStop(t: StageTree, input: StopDecisionInput = {}): StageStopDecision {
  const st = stageStopStatus(t);
  if (st.complete) return { decision: 'allow', reason: '모든 단계 완료', status: st };
  // 단계 1개 트리에서 항목이 없으면 기존과 같이 "체크리스트 없음"
  if (isSingleTask(t) && t.stages[0]!.items.length === 0)
    return { decision: 'allow', reason: '체크리스트 없음', status: st };
  if (input.stopHookActive && input.lastBlockedKey === st.progressKey)
    return {
      decision: 'allow',
      reason: `진척 없음(남은 단계 ${st.remainingStages.length}개) — 사람에게 넘깁니다`,
      status: st,
    };
  // 진행할 수 없는 상태(모두 blocked)면 사람에게
  if (st.remainingStages.every((s) => s.status === 'blocked'))
    return { decision: 'allow', reason: '막힌 단계만 남았어요 — 사람에게 넘깁니다', status: st };
  return { decision: 'block', reason: stageStopInstruction(st, t), status: st };
}

/** 단계 트리 종료 판단기 (stop.before 차단형 훅) */
export class StageStopGuard {
  private lastBlockedKey: string | undefined;
  constructor(readonly read: () => StageTree) {}

  decide(stopHookActive: boolean): StageStopDecision {
    const d = decideStageStop(this.read(), {
      stopHookActive,
      ...(this.lastBlockedKey ? { lastBlockedKey: this.lastBlockedKey } : {}),
    });
    this.lastBlockedKey = d.decision === 'block' ? d.status.progressKey : undefined;
    return d;
  }

  install(hooks: HookBus, opts: { pluginId?: string } = {}): () => void {
    return hooks.onBlocking(
      'stop.before',
      (ctx): HookResult => {
        const d = this.decide(ctx.stopHookActive === true);
        return { decision: d.decision, reason: d.reason };
      },
      { id: 'checklist-ledger:stage-stop-guard', ...(opts.pluginId ? { pluginId: opts.pluginId } : {}) },
    );
  }
}
