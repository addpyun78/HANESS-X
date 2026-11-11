import {
  draftNodeToSpec,
  type AgentDraft,
  type DraftChange,
  type DraftNode,
  type NodePermission,
  type PipelineNodeInput,
} from '@harness-x/protocol';
import { edgeId, GRID, type BuilderEdge, type BuilderGraph, type BuilderNode } from '../graph.js';

/**
 * 초안 ↔ 빌더 그래프 (순수 TS)
 * 초안은 같은 그래프 모델 위에 "초안 상태" 플래그만 더한다(T-044~T-046 동작은 그대로).
 * - draftToGraph: 초안 → 캔버스 노드·엣지 (위치는 왼쪽→오른쪽, 이전 그래프에 같은 id가 있으면 위치 유지)
 * - graphToDraft: 캔버스에서 고친 그래프 → 초안 (노드별 reason·duty는 같은 id에서 이어받는다)
 */

const STEP = 15 * GRID;

export function draftToGraph(d: AgentDraft, prev?: BuilderGraph): BuilderGraph {
  const old = new Map((prev?.nodes ?? []).map((n) => [n.id, n]));
  const nodes: BuilderNode[] = d.nodes.map((n, i) => {
    const was = old.get(n.id);
    return {
      id: n.id,
      spec: draftNodeToSpec(n),
      position: was?.position ?? { x: i * STEP, y: 4 * GRID },
      ...(was?.groupId ? { groupId: was.groupId } : {}),
    };
  });
  const edges: BuilderEdge[] = d.edges.map((e) => ({
    id: edgeId(e.from, e.to, e.onFail),
    from: e.from,
    to: e.to,
    ...(e.when ? { when: e.when } : {}),
    ...(e.onFail ? { onFail: true } : {}),
  }));
  const ids = new Set([...nodes.map((n) => n.id), ...edges.map((e) => e.id)]);
  return {
    nodes,
    edges,
    groups: (prev?.groups ?? []).filter((g) => nodes.some((n) => n.groupId === g.id)),
    selection: (prev?.selection ?? []).filter((s) => ids.has(s)),
  };
}

export const MANUAL_REASON = '직접 넣은 단계예요.';

function specToDraftNode(spec: PipelineNodeInput, base: DraftNode | undefined): DraftNode {
  const s = spec as Record<string, unknown>;
  const str = (k: string) => (typeof s[k] === 'string' && s[k] ? (s[k] as string) : undefined);
  const node: DraftNode = {
    id: spec.id,
    kind: spec.type,
    role: spec.label ?? base?.role ?? spec.id,
    duty: base?.duty ?? 'other',
    skills: spec.type === 'role' ? [...(spec.skills ?? [])] : [],
    tools: spec.type === 'role' ? [...(spec.tools ?? [])] : [],
    permission: (str('permission') as NodePermission | undefined) ?? base?.permission ?? 'read-only',
    reason: base?.reason ?? MANUAL_REASON,
  };
  const engine = str('engine');
  if (engine) node.engine = engine;
  const mode = str('mode');
  if (mode === 'subscription' || mode === 'apiKey') node.mode = mode;
  const tpl = str('checklistTemplate');
  if (tpl) node.checklistTemplate = tpl;
  const prompt = str('prompt');
  if (prompt) node.prompt = prompt;
  if (s.inputSchema) node.inputSchema = s.inputSchema as Record<string, unknown>;
  if (s.outputSchema) node.outputSchema = s.outputSchema as Record<string, unknown>;
  if (spec.type === 'subagent' && spec.agent) node.agent = spec.agent;
  if (spec.type === 'gate') node.verifiers = [...(spec.verifiers ?? [])];
  return node;
}

export function graphToDraft(g: BuilderGraph, base: AgentDraft): AgentDraft {
  const prev = new Map(base.nodes.map((n) => [n.id, n]));
  const nodes = g.nodes.map((n) => specToDraftNode(n.spec, prev.get(n.id)));
  const alive = new Set(nodes.map((n) => n.id));
  return {
    ...base,
    nodes,
    edges: g.edges.map((e) => ({
      from: e.from,
      to: e.to,
      ...(e.when ? { when: e.when } : {}),
      ...(e.onFail ? { onFail: true } : {}),
    })),
    gaps: base.gaps.filter((x) => !x.nodeId || alive.has(x.nodeId)),
  };
}

// ── 쉬운 말 ───────────────────────────────────────────────────
export const PERMISSION_PLAIN: Record<NodePermission, string> = {
  'read-only': '프로젝트 폴더 안의 파일을 읽기만 해요',
  'workspace-write': '프로젝트 폴더 안의 파일을 고칠 수 있어요',
  full: '컴퓨터의 다른 곳도 고칠 수 있어요',
};

/** 요약 카드용: 쓰는 AI 목록 · 필요한 권한(가장 넓은 것부터) */
export function draftEngines(d: AgentDraft): string[] {
  return [...new Set(d.nodes.map((n) => n.engine).filter((e): e is string => !!e && e !== 'auto'))];
}

const PERM_RANK: Record<NodePermission, number> = { full: 0, 'workspace-write': 1, 'read-only': 2 };
export function draftPermissions(d: AgentDraft): string[] {
  const perms = [...new Set(d.nodes.filter((n) => n.kind === 'role').map((n) => n.permission))];
  return perms.sort((a, b) => PERM_RANK[a] - PERM_RANK[b]).map((p) => PERMISSION_PLAIN[p]);
}

// ── P4-D.6 저장 전 점검표 ─────────────────────────────────────
export interface CheckRow {
  id: 'schema' | 'assets' | 'engines' | 'permission' | 'gaps';
  ok: boolean;
  text: string;
}

export interface ChecklistContext {
  /** 엔진 상태 (인벤토리) */
  engineHealth: Record<string, string>;
  /** 인벤토리에 있는 스킬·도구 id */
  knownSkills: ReadonlySet<string>;
  knownTools: ReadonlySet<string>;
  /** 형식 검사 결과 (protocol AgentDraftSchema) */
  schemaOk: boolean;
}

export function draftChecklist(d: AgentDraft, ctx: ChecklistContext): CheckRow[] {
  const unknown = d.nodes.flatMap((n) => [
    ...n.skills.filter((s) => !ctx.knownSkills.has(s)),
    ...n.tools.filter((t) => !ctx.knownTools.has(t)),
  ]);
  const badEngines = draftEngines(d).filter((e) => ctx.engineHealth[e] && ctx.engineHealth[e] !== 'ready');
  const wideNonWriter = d.nodes.some(
    (n) => n.kind === 'role' && n.permission !== 'read-only' && n.duty !== 'write',
  );
  const full = d.nodes.some((n) => n.permission === 'full');
  return [
    {
      id: 'schema',
      ok: ctx.schemaOk,
      text: ctx.schemaOk ? '초안 모양이 알맞아요.' : '초안 모양에 고칠 곳이 있어요.',
    },
    {
      id: 'assets',
      ok: unknown.length === 0,
      text:
        unknown.length === 0
          ? '쓰는 스킬과 도구가 모두 있어요.'
          : `없는 스킬이나 도구가 ${unknown.length}개 있어요.`,
    },
    {
      id: 'engines',
      ok: badEngines.length === 0,
      text:
        badEngines.length === 0
          ? '쓰는 AI가 모두 로그인돼 있어요.'
          : `${badEngines.map((e) => `"${e}"`).join(', ')} AI는 로그인이 필요해요.`,
    },
    {
      id: 'permission',
      ok: !wideNonWriter && !full,
      text:
        !wideNonWriter && !full
          ? '필요한 만큼만 고칠 수 있게 돼 있어요.'
          : '필요보다 넓게 고칠 수 있는 단계가 있어요.',
    },
    {
      id: 'gaps',
      ok: d.gaps.length === 0,
      text:
        d.gaps.length === 0
          ? '빈 칸이 없어요.'
          : `빈 칸이 ${d.gaps.length}개 있어요. 채워야 실행할 수 있어요.`,
    },
  ];
}

// ── P4-E.5 사람이 직접 고친 칸 ────────────────────────────────
/** 사람이 고친 칸 키: "<노드id>/<필드>" */
export type TouchKey = string;

/** 캔버스·인스펙터 동작 → 고친 칸 */
export function touchedBy(a: { type: string } & Record<string, unknown>): TouchKey[] {
  const id = (k: string) => String(a[k]);
  switch (a.type) {
    case 'setEngine':
      return [`${id('nodeId')}/engine`];
    case 'attachSkill':
    case 'detachSkill':
    case 'reorderSkill':
      return [`${id('nodeId')}/skills`];
    case 'moveSkill':
      return [`${id('from')}/skills`, `${id('to')}/skills`];
    case 'patchNode':
      return Object.keys((a.patch as Record<string, unknown>) ?? {}).map((k) =>
        k === 'label' ? `${id('nodeId')}/role` : `${id('nodeId')}/${k}`,
      );
    default:
      return [];
  }
}

const CHANGE_FIELD: Partial<Record<DraftChange['field'], string>> = {
  engine: 'engine',
  skills: 'skills',
  tools: 'tools',
  permission: 'permission',
  role: 'role',
};

/** AI 패치가 사람이 고친 칸을 바꾸려 하는가 */
export function patchConflicts(
  changes: readonly DraftChange[],
  touched: ReadonlySet<TouchKey>,
): DraftChange[] {
  return changes.filter((c) => {
    const f = c.nodeId && CHANGE_FIELD[c.field];
    return !!f && touched.has(`${c.nodeId}/${f}`);
  });
}
