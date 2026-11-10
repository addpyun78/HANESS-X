import {
  checkSchemaCompat,
  formatSchemaCompatIssues,
  type JsonSchemaLike,
  type PipelineInput,
  type PipelineNodeInput,
  type SchemaCompatIssue,
} from '@harness-x/protocol';
import {
  allIds,
  edgeId,
  graphReducer,
  GRID,
  removeIds,
  snapXY,
  uniqueId,
  type BuilderEdge,
  type BuilderGraph,
  type BuilderNode,
  type GraphAction,
  type XY,
} from '../graph.js';

/**
 * 레고 장착·분리 (순수 리듀서). graphReducer 위에 얹는다.
 * - 스킬 칩: role 노드 skills[] (순서 유지, 중복 없음)
 * - 엔진: role/subagent 노드 engine
 * - 플러그인: 파이프라인 노드들을 그룹(점선 틀)으로 펼침, 그룹째 이동·분리
 * - 포트 연결/해제 (비호환 스키마도 연결은 되지만 빨간 선)
 */
export type LegoAction =
  | GraphAction
  | { type: 'attachSkill'; nodeId: string; skill: string }
  | { type: 'detachSkill'; nodeId: string; skill: string }
  | { type: 'moveSkill'; from: string; to: string; skill: string }
  | { type: 'setEngine'; nodeId: string; engine: string }
  | { type: 'addPlugin'; pluginId: string; label: string; pipeline: PipelineInput; position: XY }
  | { type: 'moveGroup'; id: string; position: XY }
  | { type: 'detachGroup'; id: string }
  | { type: 'connect'; from: string; to: string }
  | { type: 'disconnect'; id: string };

const GROUP_PAD = 2 * GRID;
const STEP = 15 * GRID;

export const acceptsSkills = (spec: PipelineNodeInput) => spec.type === 'role';
export const acceptsEngine = (spec: PipelineNodeInput) => spec.type === 'role' || spec.type === 'subagent';

export function skillsOf(spec: PipelineNodeInput): string[] {
  return spec.type === 'role' ? (spec.skills ?? []) : [];
}

function patchNode(
  g: BuilderGraph,
  id: string,
  f: (n: BuilderNode) => BuilderNode | undefined,
): BuilderGraph {
  let changed = false;
  const nodes = g.nodes.map((n) => {
    if (n.id !== id) return n;
    const next = f(n);
    if (!next || next === n) return n;
    changed = true;
    return next;
  });
  return changed ? { ...g, nodes } : g;
}

const withSkills = (n: BuilderNode, skills: string[]): BuilderNode =>
  n.spec.type === 'role' ? { ...n, spec: { ...n.spec, skills } } : n;

export function legoReducer(g: BuilderGraph, a: LegoAction): BuilderGraph {
  switch (a.type) {
    case 'attachSkill':
      return patchNode(g, a.nodeId, (n) => {
        const cur = skillsOf(n.spec);
        if (!acceptsSkills(n.spec) || cur.includes(a.skill)) return undefined;
        return withSkills(n, [...cur, a.skill]);
      });
    case 'detachSkill':
      return patchNode(g, a.nodeId, (n) => {
        const cur = skillsOf(n.spec);
        return cur.includes(a.skill)
          ? withSkills(
              n,
              cur.filter((s) => s !== a.skill),
            )
          : undefined;
      });
    case 'moveSkill': {
      if (a.from === a.to) return g;
      const target = g.nodes.find((n) => n.id === a.to);
      if (!target || !acceptsSkills(target.spec)) return g;
      const detached = legoReducer(g, { type: 'detachSkill', nodeId: a.from, skill: a.skill });
      return legoReducer(detached, { type: 'attachSkill', nodeId: a.to, skill: a.skill });
    }
    case 'setEngine':
      return patchNode(g, a.nodeId, (n) => {
        if (!acceptsEngine(n.spec) || ('engine' in n.spec && n.spec.engine === a.engine)) return undefined;
        return { ...n, spec: { ...n.spec, engine: a.engine } as PipelineNodeInput };
      });
    case 'addPlugin':
      return addPlugin(g, a);
    case 'moveGroup':
      return {
        ...g,
        groups: g.groups.map((x) => (x.id === a.id ? { ...x, position: snapXY(a.position) } : x)),
      };
    case 'detachGroup':
      return g.groups.some((x) => x.id === a.id) ? removeIds(g, [a.id]) : g;
    case 'connect': {
      const id = edgeId(a.from, a.to);
      const ok =
        a.from !== a.to &&
        g.nodes.some((n) => n.id === a.from) &&
        g.nodes.some((n) => n.id === a.to) &&
        !g.edges.some((e) => e.id === id);
      return ok ? { ...g, edges: [...g.edges, { id, from: a.from, to: a.to }] } : g;
    }
    case 'disconnect':
      return g.edges.some((e) => e.id === a.id) ? { ...g, edges: g.edges.filter((e) => e.id !== a.id) } : g;
    default:
      return graphReducer(g, a);
  }
}

/** 플러그인 파이프라인 → 그룹 + 노드(겹치는 id는 새 id로) + 내부 엣지 */
function addPlugin(g: BuilderGraph, a: Extract<LegoAction, { type: 'addPlugin' }>): BuilderGraph {
  const taken = new Set(allIds(g));
  const groupId = uniqueId(`plugin-${a.pluginId}`, taken);
  taken.add(groupId);
  const rename = new Map<string, string>();
  for (const spec of a.pipeline.nodes) {
    const id = uniqueId(spec.id, taken);
    taken.add(id);
    rename.set(spec.id, id);
  }
  const nodes: BuilderNode[] = a.pipeline.nodes.map((spec, i) => {
    const id = rename.get(spec.id)!;
    return {
      id,
      spec: { ...(structuredClone(spec) as PipelineNodeInput), id },
      position: { x: GROUP_PAD + i * STEP, y: GROUP_PAD },
      groupId,
    };
  });
  const edges: BuilderEdge[] = (a.pipeline.edges ?? []).map((e) => {
    const from = rename.get(e.from) ?? e.from;
    const to = rename.get(e.to) ?? e.to;
    return {
      id: edgeId(from, to, e.onFail),
      from,
      to,
      ...(e.when ? { when: e.when } : {}),
      ...(e.onFail ? { onFail: true } : {}),
    };
  });
  return {
    nodes: [...g.nodes, ...nodes],
    edges: [...g.edges, ...edges],
    groups: [
      ...g.groups,
      { id: groupId, pluginId: a.pluginId, label: a.label, position: snapXY(a.position) },
    ],
    selection: [groupId],
  };
}

/** 그룹을 떼어낼 때 다른 에이전트에 붙일 수 있도록 파이프라인으로 뽑기 */
export function extractGroup(g: BuilderGraph, groupId: string): PipelineInput | undefined {
  const group = g.groups.find((x) => x.id === groupId);
  if (!group) return undefined;
  const nodes = g.nodes.filter((n) => n.groupId === groupId);
  const ids = new Set(nodes.map((n) => n.id));
  return {
    name: uniqueId(group.pluginId, []),
    displayName: group.label,
    nodes: nodes.map((n) => n.spec),
    edges: g.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({
        from: e.from,
        to: e.to,
        ...(e.when ? { when: e.when } : {}),
        ...(e.onFail ? { onFail: true } : {}),
      })),
  };
}

// ── 연결선 호환성 ─────────────────────────────────────────────
const schemaOf = (spec: PipelineNodeInput | undefined, key: 'inputSchema' | 'outputSchema') =>
  spec && key in spec ? ((spec as Record<string, unknown>)[key] as JsonSchemaLike | undefined) : undefined;

export interface EdgeCompat {
  compatible: boolean;
  issues: SchemaCompatIssue[];
  /** 툴팁 사유 (호환이면 빈 문자열) */
  reason: string;
}

export function edgeCompat(g: BuilderGraph, e: Pick<BuilderEdge, 'from' | 'to' | 'onFail'>): EdgeCompat {
  // gate 실패 되돌림은 데이터 전달이 아니다
  if (e.onFail) return { compatible: true, issues: [], reason: '' };
  const from = g.nodes.find((n) => n.id === e.from)?.spec;
  const to = g.nodes.find((n) => n.id === e.to)?.spec;
  const r = checkSchemaCompat(schemaOf(from, 'outputSchema'), schemaOf(to, 'inputSchema'));
  return {
    ...r,
    reason: r.compatible ? '' : `${e.from} → ${e.to} 비호환\n${formatSchemaCompatIssues(r.issues)}`,
  };
}
