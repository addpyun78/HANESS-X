import type { NodeType, Pipeline, PipelineInput, PipelineNodeInput } from '@harness-x/protocol';

/**
 * 빌더 그래프 모델 (순수 TS — DOM·React Flow 없이 단위 테스트 가능).
 * - 노드 = 파이프라인 노드 명세(spec) + 캔버스 위치
 * - 그룹 = 캔버스에 펼친 플러그인(점선 틀). 그룹 안 노드의 위치는 그룹 기준 상대 좌표
 * - 엣지 = 노드 포트 연결
 */

export const GRID = 16;

export interface XY {
  x: number;
  y: number;
}

export interface BuilderNode {
  id: string;
  spec: PipelineNodeInput;
  position: XY;
  /** 속한 플러그인 그룹 (있으면 position은 그룹 기준) */
  groupId?: string;
}

export interface BuilderGroup {
  id: string;
  /** 출처 플러그인 id */
  pluginId: string;
  label: string;
  position: XY;
}

export interface BuilderEdge {
  id: string;
  from: string;
  to: string;
  when?: string;
  onFail?: boolean;
}

export interface BuilderGraph {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  groups: BuilderGroup[];
  /** 선택된 노드·엣지·그룹 id */
  selection: string[];
}

export const emptyGraph = (): BuilderGraph => ({ nodes: [], edges: [], groups: [], selection: [] });

export const snap = (v: number) => Math.round(v / GRID) * GRID;
export const snapXY = (p: XY): XY => ({ x: snap(p.x), y: snap(p.y) });

export const NODE_LABEL: Record<NodeType, string> = {
  role: '역할',
  gate: '게이트',
  fanout: '분기',
  join: '합류',
  loop: '반복',
  router: '라우터',
  subagent: '서브에이전트',
};

/** 서랍에서 끌어 놓은 새 노드의 기본 명세 */
export function defaultSpec(type: NodeType, id: string): PipelineNodeInput {
  const label = NODE_LABEL[type];
  switch (type) {
    case 'role':
      return { id, type, label, engine: 'auto', skills: [], tools: [] };
    case 'gate':
      return { id, type, label, verifiers: [] };
    case 'subagent':
      return { id, type, label, agent: '' };
    default:
      return { id, type, label };
  }
}

/** 이미 쓰인 id와 겹치지 않는 kebab-case id */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^[^a-z]+/, '') || 'node';
  if (!set.has(clean)) return clean;
  for (let i = 2; ; i++) if (!set.has(`${clean}-${i}`)) return `${clean}-${i}`;
}

export const allIds = (g: BuilderGraph) => [
  ...g.nodes.map((n) => n.id),
  ...g.groups.map((x) => x.id),
  ...g.edges.map((e) => e.id),
];

export const edgeId = (from: string, to: string, onFail?: boolean) =>
  `e:${from}>${to}${onFail ? ':fail' : ''}`;

/** 파이프라인 → 그래프 (노드는 위→아래 단계별 배치) */
export function graphFromPipeline(p: Pipeline | PipelineInput, origin: XY = { x: 0, y: 0 }): BuilderGraph {
  const nodes = p.nodes.map((spec, i) => ({
    id: spec.id,
    spec: structuredClone(spec) as PipelineNodeInput,
    position: { x: origin.x + i * 15 * GRID, y: origin.y },
  }));
  const edges = (p.edges ?? []).map((e) => ({
    id: edgeId(e.from, e.to, e.onFail),
    from: e.from,
    to: e.to,
    ...(e.when ? { when: e.when } : {}),
    ...(e.onFail ? { onFail: true } : {}),
  }));
  return { nodes, edges, groups: [], selection: [] };
}

export type GraphAction =
  | { type: 'addNode'; nodeType: NodeType; position: XY; id?: string }
  | { type: 'moveNode'; id: string; position: XY }
  | { type: 'select'; ids: string[]; additive?: boolean }
  | { type: 'removeSelected' }
  | { type: 'removeNodes'; ids: string[] }
  | { type: 'load'; graph: BuilderGraph };

export function graphReducer(g: BuilderGraph, a: GraphAction): BuilderGraph {
  switch (a.type) {
    case 'addNode': {
      const id = a.id ?? uniqueId(a.nodeType, allIds(g));
      return {
        ...g,
        nodes: [...g.nodes, { id, spec: defaultSpec(a.nodeType, id), position: snapXY(a.position) }],
        selection: [id],
      };
    }
    case 'moveNode':
      return {
        ...g,
        nodes: g.nodes.map((n) => (n.id === a.id ? { ...n, position: snapXY(a.position) } : n)),
      };
    case 'select': {
      const ids = a.additive ? [...new Set([...g.selection, ...a.ids])] : a.ids;
      return sameList(ids, g.selection) ? g : { ...g, selection: ids };
    }
    case 'removeSelected':
      return removeIds(g, g.selection);
    case 'removeNodes':
      return removeIds(g, a.ids);
    case 'load':
      return a.graph;
  }
}

/** 노드·엣지·그룹 id 목록 제거 (그룹을 지우면 그 안의 노드도, 노드를 지우면 이어진 엣지도) */
export function removeIds(g: BuilderGraph, ids: readonly string[]): BuilderGraph {
  if (ids.length === 0) return g;
  const gone = new Set(ids);
  const groups = g.groups.filter((x) => !gone.has(x.id));
  const nodes = g.nodes.filter((n) => !gone.has(n.id) && !(n.groupId && gone.has(n.groupId)));
  const alive = new Set(nodes.map((n) => n.id));
  const edges = g.edges.filter((e) => !gone.has(e.id) && alive.has(e.from) && alive.has(e.to));
  return { nodes, edges, groups, selection: g.selection.filter((s) => !gone.has(s)) };
}

function sameList(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
