import type { PipelineNodeInput } from '@harness-x/protocol';
import type { BuilderGraph } from './graph.js';

/**
 * T-101 5D.2~5D.4 에이전트 설정 "AI 고르는 방식"
 *   follow-main(기본): 모든 노드 `engine: main` — 메인 AI를 바꾸면 같이 바뀐다
 *   per-node: 노드마다 직접 고른 엔진 id (고정)
 * 저장은 agent.yaml 노드의 engine 값으로만 한다 (`engine: main` 또는 구체 id) — 따로 둔 설정 칸이 없다.
 */

export const MAIN_REF = 'main';
export type AiChoiceMode = 'follow-main' | 'per-node';

export const AI_MODE_LABEL: Record<AiChoiceMode, string> = {
  'follow-main': '메인 AI 따라가기',
  'per-node': '노드마다 직접 고르기',
};

/** 엔진을 고르는 노드 (role·subagent) */
const hasEngine = (s: PipelineNodeInput): s is Extract<PipelineNodeInput, { engine?: string }> =>
  s.type === 'role' || s.type === 'subagent';

/** 'main'·'auto'·미지정 = 메인 따라가기 */
export const followsMain = (engine: string | undefined): boolean =>
  !engine || engine === MAIN_REF || engine === 'auto';

export function aiChoiceMode(g: Pick<BuilderGraph, 'nodes'>): AiChoiceMode {
  const nodes = g.nodes.filter((n) => hasEngine(n.spec));
  return nodes.every((n) => followsMain((n.spec as { engine?: string }).engine)) ? 'follow-main' : 'per-node';
}

/**
 * 방식 바꾸기: follow-main → 모든 노드 engine: main / per-node → 메인을 따르던 노드는 지금 메인 엔진으로 고정
 * (이미 고정된 노드는 그대로)
 */
export function setAiChoiceMode<G extends Pick<BuilderGraph, 'nodes'>>(
  g: G,
  mode: AiChoiceMode,
  mainEngine: string | undefined,
): G {
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      if (!hasEngine(n.spec)) return n;
      const cur = (n.spec as { engine?: string }).engine;
      if (mode === 'follow-main') return { ...n, spec: { ...n.spec, engine: MAIN_REF } };
      if (followsMain(cur) && mainEngine) return { ...n, spec: { ...n.spec, engine: mainEngine } };
      return n;
    }),
  };
}

/** 5D.3 노드 엔진 칩: 따라가기면 `메인(claude-code)`, 직접이면 고정 이름 */
export function engineChipLabel(engine: string | undefined, mainEngine: string | undefined): string {
  if (followsMain(engine)) return mainEngine ? `메인(${mainEngine})` : '메인';
  return engine!;
}
