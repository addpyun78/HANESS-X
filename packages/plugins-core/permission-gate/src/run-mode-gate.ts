import type { RunMode } from '@harness-x/protocol';
import type { BlockingHandler, HookContext, HookResult, RegisterOptions } from '@harness-x/kernel';
import {
  classifyHumanOnly,
  destructiveShell,
  DESTRUCTIVE_REASON,
  humanOnlyReason,
  type HumanOnlyMatch,
} from './human-only.js';
import { SHELL_TOOLS, writeIntentOf, type PlanGateOptions } from './plan-gate.js';

/**
 * T-101 3. 실행 모드 게이트 — HookBus `tool.before`(차단형). 엔진 인자와 상관없이 **최종 판단은 하네스가** 한다.
 *  3B.1 계획 모드: 모든 쓰기 도구(파일 쓰기·쓰기형 셸)를 막는다. 읽기와 체크리스트 작성만 된다.
 *       체크리스트가 만들어지면 실행기는 계획 확인을 기다린다(`planModeNext`).
 *  3D.4 오토(와 계획) 모드: 사람 전용 작업(설치·제거·결제·에이전트 저장·Forge 설치)은 실행하지 않고
 *       onHumanOnly로 "돌아오면 확인할 것"에 올린다. 오토에서는 파괴적 명령도 막는다(onDestructive).
 *       워크스페이스 밖 쓰기는 계획 게이트 + 오토 승인기(auto-policy.ts)가 막는다.
 * 일반 모드는 이 게이트가 아무것도 하지 않는다(기존 계획 게이트·승인 카드가 그대로 동작, 3C.1).
 */

export interface RunModeGateOptions extends Pick<PlanGateOptions, 'writeTools' | 'shellTools'> {
  /** 지금 모드 (턴마다 바뀔 수 있어 함수로 받는다) */
  mode: () => RunMode;
  /** 3D.4 사람 전용 작업을 막았을 때 (확인 목록에 올리기). reason은 쉬운 말 */
  onHumanOnly?: (m: HumanOnlyMatch & { reason: string }, ctx: HookContext) => void;
  /** 3D.4 오토에서 파괴적 명령을 막았을 때 */
  onDestructive?: (m: { why: string; reason: string }, ctx: HookContext) => void;
}

export const PLAN_MODE_DENY =
  'plan_mode: 계획 모드에서는 파일을 바꾸지 않아요. 읽기와 체크리스트 작성만 할 수 있어요 (checklist.propose).';

export interface RunModeGate {
  handler: BlockingHandler;
}

export function createRunModeGate(opts: RunModeGateOptions): RunModeGate {
  const handler: BlockingHandler = (ctx): HookResult | void => {
    const mode = opts.mode();
    if (mode === 'normal') return;
    const tool = typeof ctx.tool === 'string' ? ctx.tool : '';
    // 3D.4 사람 전용 작업 — 계획·오토 어디서도 AI가 하지 않는다
    const human = classifyHumanOnly(tool, ctx.input, opts.shellTools);
    if (human) {
      const reason = humanOnlyReason(human.kind);
      opts.onHumanOnly?.({ ...human, reason }, ctx);
      return { decision: 'deny', reason: `human_only: ${human.why} — ${reason}` };
    }
    if (mode === 'auto') {
      const shells = opts.shellTools ?? SHELL_TOOLS;
      if (shells.includes(tool)) {
        const a = ctx.input && typeof ctx.input === 'object' ? (ctx.input as Record<string, unknown>) : {};
        const raw = typeof ctx.input === 'string' ? ctx.input : (a.command ?? a.cmd);
        const cmd = Array.isArray(raw)
          ? (raw as unknown[]).map(String).join(' ')
          : typeof raw === 'string'
            ? raw
            : '';
        const why = destructiveShell(cmd);
        if (why) {
          opts.onDestructive?.({ why, reason: DESTRUCTIVE_REASON }, ctx);
          return { decision: 'deny', reason: `destructive: ${why} — ${DESTRUCTIVE_REASON}` };
        }
      }
      return;
    }
    const intent = writeIntentOf(tool, ctx.input, opts);
    if (!intent.write) return;
    return {
      decision: 'deny',
      reason: `${PLAN_MODE_DENY} (${tool}${intent.reasons?.length ? `: ${intent.reasons.join(', ')}` : ''})`,
    };
  };
  return { handler };
}

/** 3B.1 계획 모드에서 체크리스트를 만든 뒤 실행기가 할 일: 계획 확인 대기 */
export function planModeNext(mode: RunMode, hasChecklist: boolean): 'continue' | 'await-plan-confirm' {
  return mode === 'plan' && hasChecklist ? 'await-plan-confirm' : 'continue';
}

export const RUN_MODE_GATE_HOOK_ID = 'permission-gate:run-mode';

/** tool.before에 모드 게이트 설치 (계획 게이트보다 먼저: priority 5). 반환: 해제 함수 */
export function installRunModeGate(
  hooks: {
    onBlocking(
      name: 'tool.before',
      handler: BlockingHandler,
      opts?: Omit<RegisterOptions, 'pluginId'>,
    ): () => void;
  },
  opts: RunModeGateOptions,
): { gate: RunModeGate; dispose: () => void } {
  const gate = createRunModeGate(opts);
  const dispose = hooks.onBlocking('tool.before', gate.handler, {
    id: RUN_MODE_GATE_HOOK_ID,
    priority: 5,
    failMode: 'deny',
    timeoutMs: 10_000,
  });
  return { gate, dispose };
}
