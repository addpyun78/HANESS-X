import type { BuilderCatalog } from './catalog.js';
import { emptyGraph, graphFromPipeline, GRID, type BuilderGraph } from './graph.js';

/** 빌더 시작 선택: 빈 캔버스 / 플러그인에서 시작 / 기존 에이전트 복제 */
export type StartChoice =
  { kind: 'empty' } | { kind: 'plugin'; pluginId: string } | { kind: 'clone'; agentId: string };

export interface StartResult {
  graph: BuilderGraph;
  /** 제안 에이전트 이름 (저장 시 기본값) */
  name: string;
  /** 출처 설명 */
  origin: string;
}

const ORIGIN = { x: 4 * GRID, y: 4 * GRID };

export function startGraph(choice: StartChoice, catalog: BuilderCatalog): StartResult {
  switch (choice.kind) {
    case 'empty':
      return { graph: emptyGraph(), name: 'new-agent', origin: '빈 캔버스' };
    case 'plugin': {
      const p = catalog.plugins.find((x) => x.id === choice.pluginId);
      if (!p?.pipeline) throw new Error(`플러그인 파이프라인을 찾을 수 없음: ${choice.pluginId}`);
      return { graph: graphFromPipeline(p.pipeline, ORIGIN), name: p.id, origin: `플러그인 ${p.label}` };
    }
    case 'clone': {
      const a = catalog.agents.find((x) => x.id === choice.agentId);
      if (!a?.pipeline) throw new Error(`에이전트 파이프라인을 찾을 수 없음: ${choice.agentId}`);
      return {
        graph: graphFromPipeline(a.pipeline, ORIGIN),
        name: `${a.id}-copy`,
        origin: `${a.label} 복제`,
      };
    }
  }
}
