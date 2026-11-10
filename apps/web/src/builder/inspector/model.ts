import type { JsonSchemaObject, NodePermission, PipelineNodeInput } from '@harness-x/protocol';
import type { BuilderGraph, BuilderNode } from '../graph.js';
import { legoReducer, type LegoAction } from '../lego/model.js';
import { graphFromYaml } from './yaml.js';

/**
 * 인스펙터 편집 (순수 리듀서). legoReducer 위에 얹는다.
 * - patchNode: 선택 노드 명세 필드 편집 (이름·엔진·인증 모드·권한·체크리스트 템플릿·입출력 스키마)
 *   값이 undefined면 그 필드를 지운다.
 * - reorderSkill: 스킬 칩 순서 바꾸기
 * - loadYaml: YAML 편집 → 그래프 (위치·그룹은 같은 id 노드에서 이어받는다)
 */

/** 인스펙터가 고칠 수 있는 필드 */
export interface NodePatch {
  label?: string | undefined;
  engine?: string | undefined;
  mode?: 'subscription' | 'apiKey' | undefined;
  permission?: NodePermission | undefined;
  checklistTemplate?: string | undefined;
  inputSchema?: JsonSchemaObject | undefined;
  outputSchema?: JsonSchemaObject | undefined;
  prompt?: string | undefined;
}

export type InspectorAction =
  | LegoAction
  | { type: 'patchNode'; nodeId: string; patch: NodePatch }
  | { type: 'reorderSkill'; nodeId: string; from: number; to: number }
  | { type: 'loadYaml'; text: string };

/** 노드 종류마다 쓸 수 있는 필드 */
const FIELDS: Record<PipelineNodeInput['type'], (keyof NodePatch)[]> = {
  role: [
    'label',
    'engine',
    'mode',
    'permission',
    'checklistTemplate',
    'inputSchema',
    'outputSchema',
    'prompt',
  ],
  gate: ['label', 'checklistTemplate'],
  subagent: ['label', 'engine', 'inputSchema', 'outputSchema'],
  fanout: ['label'],
  join: ['label'],
  loop: ['label'],
  router: ['label'],
};

export const editableFields = (spec: PipelineNodeInput) => FIELDS[spec.type];

export function patchSpec(spec: PipelineNodeInput, patch: NodePatch): PipelineNodeInput {
  const allowed = new Set(FIELDS[spec.type]);
  const next = { ...spec } as Record<string, unknown>;
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.has(k as keyof NodePatch)) continue;
    const empty = v === undefined || v === '';
    if (empty) {
      if (k in next) {
        delete next[k];
        changed = true;
      }
    } else if (JSON.stringify(next[k]) !== JSON.stringify(v)) {
      next[k] = v;
      changed = true;
    }
  }
  return changed ? (next as PipelineNodeInput) : spec;
}

function mapNode(g: BuilderGraph, id: string, f: (n: BuilderNode) => BuilderNode): BuilderGraph {
  let changed = false;
  const nodes = g.nodes.map((n) => {
    if (n.id !== id) return n;
    const next = f(n);
    if (next !== n) changed = true;
    return next;
  });
  return changed ? { ...g, nodes } : g;
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

export function inspectorReducer(g: BuilderGraph, a: InspectorAction): BuilderGraph {
  switch (a.type) {
    case 'patchNode':
      return mapNode(g, a.nodeId, (n) => {
        const spec = patchSpec(n.spec, a.patch);
        return spec === n.spec ? n : { ...n, spec };
      });
    case 'reorderSkill':
      return mapNode(g, a.nodeId, (n) => {
        if (n.spec.type !== 'role') return n;
        const skills = n.spec.skills ?? [];
        const next = moveItem(skills, a.from, a.to);
        if (next.every((s, i) => s === skills[i])) return n;
        return { ...n, spec: { ...n.spec, skills: next } };
      });
    case 'loadYaml': {
      const r = graphFromYaml(a.text, g);
      return r.ok ? r.graph : g;
    }
    default:
      return legoReducer(g, a);
  }
}

/** JSON 스키마 입력칸 텍스트 → 객체 (빈 칸 = undefined, 잘못된 JSON이면 오류 문구) */
export function parseSchemaText(
  text: string,
): { ok: true; value: JsonSchemaObject | undefined } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: undefined };
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'JSON 객체여야 합니다' };
    return { ok: true, value: v as JsonSchemaObject };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
