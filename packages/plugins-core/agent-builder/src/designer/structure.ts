import {
  checkPipelineGraph,
  draftToPipeline,
  PipelineNodeSchema,
  type AgentDraft,
  type DraftEdge,
  type Pipeline,
} from '@harness-x/protocol';
import { checkPipelineContracts } from '../contract.js';

/**
 * P4-C.8 구조 검사
 *   1) 순환 금지(loop 노드 제외) → 순환을 닫는 연결을 빼서 자동 교정
 *   2) 노드 간 스키마 호환(T-042 정적 검사 checkPipelineContracts) → 경고
 *   3) 권한 최소화 린트: 쓰기 담당(duty=write)이 아니면 읽기 전용, 쓰기 담당도 full은 workspace-write로
 * 사용자에게 보이는 메시지는 쉬운 말.
 */

export interface StructureNotice {
  code: 'cycle-removed' | 'schema-mismatch' | 'permission-reduced' | 'graph-rule';
  nodeId?: string;
  message: string;
  /** 자동으로 고쳤나 (false = 경고만) */
  fixed: boolean;
}

export interface StructureResult {
  draft: AgentDraft;
  notices: StructureNotice[];
}

/** loop 노드를 지나지 않는 순환을 닫는 엣지 하나 (없으면 undefined) */
export function findCycleEdge(d: Pick<AgentDraft, 'nodes' | 'edges'>): DraftEdge | undefined {
  const kind = new Map(d.nodes.map((n) => [n.id, n.kind]));
  const normal = d.edges.filter((e) => !e.onFail && kind.get(e.from) !== 'loop' && kind.get(e.to) !== 'loop');
  const color = new Map<string, number>();
  let found: DraftEdge | undefined;
  const dfs = (id: string): boolean => {
    color.set(id, 1);
    for (const e of normal.filter((x) => x.from === id)) {
      const c = color.get(e.to) ?? 0;
      if (c === 1) {
        found = e;
        return true;
      }
      if (c === 0 && dfs(e.to)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const n of d.nodes) if ((color.get(n.id) ?? 0) === 0 && kind.get(n.id) !== 'loop' && dfs(n.id)) break;
  return found;
}

/** 초안 → 기본값이 채워진 파이프라인 (그래프 규칙 검사 없이 노드만 파싱) */
export function draftPipeline(d: AgentDraft): Pipeline {
  const p = draftToPipeline(d);
  return {
    name: p.name,
    version: 1,
    ...(p.displayName ? { displayName: p.displayName } : {}),
    nodes: p.nodes.map((n) => PipelineNodeSchema.parse(n)),
    edges: (p.edges ?? []).map((e) => ({ ...e, onFail: !!e.onFail })),
  } as Pipeline;
}

const roleOf = (d: AgentDraft, id: string) => d.nodes.find((n) => n.id === id)?.role ?? id;

export function checkStructure(input: AgentDraft): StructureResult {
  const notices: StructureNotice[] = [];
  let d = input;

  // 1) 순환
  for (let guard = 0; guard < d.edges.length + 1; guard++) {
    const e = findCycleEdge(d);
    if (!e) break;
    d = { ...d, edges: d.edges.filter((x) => x !== e) };
    notices.push({
      code: 'cycle-removed',
      nodeId: e.to,
      message: `"${roleOf(d, e.from)}"에서 "${roleOf(d, e.to)}"로 되돌아가는 연결을 뺐어요. 반복은 반복 블록으로만 할 수 있어요.`,
      fixed: true,
    });
  }

  // 3) 권한 최소화
  d = {
    ...d,
    nodes: d.nodes.map((n) => {
      if (n.kind !== 'role') return n;
      if (n.duty !== 'write' && n.permission !== 'read-only') {
        notices.push({
          code: 'permission-reduced',
          nodeId: n.id,
          message: `"${n.role}"는 파일을 고칠 일이 없어서 읽기만 하게 바꿨어요.`,
          fixed: true,
        });
        return { ...n, permission: 'read-only' as const };
      }
      if (n.duty === 'write' && n.permission === 'full') {
        notices.push({
          code: 'permission-reduced',
          nodeId: n.id,
          message: `"${n.role}"는 프로젝트 폴더 안에서만 고치게 바꿨어요.`,
          fixed: true,
        });
        return { ...n, permission: 'workspace-write' as const };
      }
      return n;
    }),
  };

  // 2) 스키마 호환 (경고) + 남은 그래프 규칙 (경고)
  try {
    for (const i of checkPipelineContracts(draftPipeline(d)))
      notices.push({
        code: 'schema-mismatch',
        nodeId: i.to,
        message: `"${roleOf(d, i.from)}"의 결과 모양이 "${roleOf(d, i.to)}"가 받는 모양과 달라요.`,
        fixed: false,
      });
  } catch {
    // 노드 명세가 잘못된 경우는 스키마 검사(C.5)에서 걸린다
  }
  for (const m of checkPipelineGraph(draftToPipeline(d) as Parameters<typeof checkPipelineGraph>[0]))
    if (!/순환/.test(m))
      notices.push({
        code: 'graph-rule',
        message: `연결 규칙에 맞지 않는 곳이 있어요. (${m})`,
        fixed: false,
      });
  return { draft: d, notices };
}
