import {
  PipelineSchema,
  stringifyPipeline,
  type PipelineInput,
  type PipelineNodeInput,
} from '@harness-x/protocol';
import { parse as parseYaml } from 'yaml';
import { edgeId, GRID, type BuilderEdge, type BuilderGraph, type BuilderNode } from '../graph.js';

/**
 * "YAML 보기" 탭: 그래프 ↔ pipeline.yaml (양방향)
 * - 그래프 → YAML: 노드 명세를 그대로(기본값을 채우지 않고) 직렬화한다 → YAML → 그래프 → YAML이 글자 하나 다르지 않다.
 * - YAML → 그래프: 스키마 검사 뒤, 같은 id 노드의 캔버스 위치·그룹을 이어받는다(새 노드는 오른쪽에 줄 세움).
 * 플러그인 그룹(점선 틀)은 캔버스 전용 정보라 YAML에는 없다.
 */

export interface PipelineMeta {
  name: string;
  displayName?: string;
  description?: string;
  entry?: string;
}

const STEP = 15 * GRID;

export function graphToPipeline(g: BuilderGraph, meta: PipelineMeta): PipelineInput {
  return {
    name: meta.name,
    ...(meta.displayName ? { displayName: meta.displayName } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.entry ? { entry: meta.entry } : {}),
    nodes: g.nodes.map((n) => n.spec),
    edges: g.edges.map((e) => ({
      from: e.from,
      to: e.to,
      ...(e.when ? { when: e.when } : {}),
      ...(e.onFail ? { onFail: true } : {}),
    })),
  };
}

export function graphToYaml(g: BuilderGraph, meta: PipelineMeta): string {
  return stringifyPipeline(graphToPipeline(g, meta));
}

export type YamlResult =
  | { ok: true; graph: BuilderGraph; meta: PipelineMeta; pipeline: PipelineInput }
  | { ok: false; errors: string[] };

/** YAML 텍스트 → 그래프 (prev가 있으면 위치·그룹·선택을 이어받는다) */
export function graphFromYaml(text: string, prev?: BuilderGraph): YamlResult {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    return { ok: false, errors: [`YAML 문법 오류: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const checked = PipelineSchema.safeParse(raw);
  if (!checked.success)
    return {
      ok: false,
      errors: checked.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message),
    };
  // 기본값이 채워진 결과가 아니라 사용자가 쓴 그대로를 그래프에 넣는다 (왕복 동일)
  const p = raw as PipelineInput;
  const old = new Map((prev?.nodes ?? []).map((n) => [n.id, n]));
  const maxX = Math.max(0, ...(prev?.nodes ?? []).filter((n) => !n.groupId).map((n) => n.position.x));
  let fresh = 0;
  const nodes: BuilderNode[] = p.nodes.map((spec) => {
    const was = old.get(spec.id);
    if (was) return { ...was, spec: spec as PipelineNodeInput };
    const x = (prev?.nodes.length ? maxX + STEP : 0) + fresh++ * STEP;
    return { id: spec.id, spec: spec as PipelineNodeInput, position: { x, y: 4 * GRID } };
  });
  const groupsInUse = new Set(nodes.map((n) => n.groupId).filter(Boolean));
  const edges: BuilderEdge[] = (p.edges ?? []).map((e) => ({
    id: edgeId(e.from, e.to, e.onFail),
    from: e.from,
    to: e.to,
    ...(e.when ? { when: e.when } : {}),
    ...(e.onFail ? { onFail: true } : {}),
  }));
  const ids = new Set([...nodes.map((n) => n.id), ...edges.map((e) => e.id)]);
  const groups = (prev?.groups ?? []).filter((x) => groupsInUse.has(x.id));
  groups.forEach((x) => ids.add(x.id));
  const meta: PipelineMeta = {
    name: p.name,
    ...(p.displayName ? { displayName: p.displayName } : {}),
    ...(p.description ? { description: p.description } : {}),
    ...(p.entry ? { entry: p.entry } : {}),
  };
  return {
    ok: true,
    graph: { nodes, edges, groups, selection: (prev?.selection ?? []).filter((s) => ids.has(s)) },
    meta,
    pipeline: p,
  };
}
