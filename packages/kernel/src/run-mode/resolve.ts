import { DEFAULT_RUN_MODE, toRunMode, type RunMode } from '@harness-x/protocol';

/**
 * T-101 3E.3 실행 모드 우선순위:
 *   이번 실행 수식어(!plan·!auto) > 입력창 칩 > 에이전트 기본값(agent.yaml defaultMode)
 *   > 프로젝트 기본값(0B.40) > 전체 설정 기본값(mode.default) > 'normal'
 * 모르는 값은 건너뛴다.
 */

export const MODE_SOURCES = ['modifier', 'chip', 'agent', 'project', 'global', 'fallback'] as const;
export type ModeSource = (typeof MODE_SOURCES)[number];

export interface ModeInputs {
  modifier?: unknown;
  chip?: unknown;
  agent?: unknown;
  project?: unknown;
  global?: unknown;
}

export interface ResolvedMode {
  mode: RunMode;
  from: ModeSource;
}

export function resolveRunMode(i: ModeInputs): ResolvedMode {
  for (const from of ['modifier', 'chip', 'agent', 'project', 'global'] as const) {
    const m = toRunMode(i[from]);
    if (m) return { mode: m, from };
  }
  return { mode: DEFAULT_RUN_MODE, from: 'fallback' };
}

/** 3E.2 노드별 모드: 노드에 runMode가 있으면 그 노드만 그 모드 (예: 검사 노드는 plan) */
export function nodeRunMode(run: RunMode, node: { runMode?: unknown }): RunMode {
  return toRunMode(node.runMode) ?? run;
}
