import type { AgentDraft, DraftNode } from './agent-draft.js';

/**
 * T-100 P4-E.4 초안 두 개의 "바뀐 점" (쉬운 말) + 바뀐 노드·칩 (캔버스 노란색 표시)
 */

export interface DraftChange {
  /** 바뀐 노드 (없으면 초안 전체 정보) */
  nodeId?: string;
  field:
    | 'node-added'
    | 'node-removed'
    | 'engine'
    | 'skills'
    | 'tools'
    | 'permission'
    | 'role'
    | 'edges'
    | 'gaps'
    | 'meta';
  /** 새로 붙은 칩 (스킬·도구 id) */
  chips?: string[];
  message: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const PERM: Record<string, string> = {
  'read-only': '읽기만',
  'workspace-write': '프로젝트 폴더 안에서 고치기',
  full: '모든 곳 고치기',
};

export function diffDrafts(a: AgentDraft, b: AgentDraft): DraftChange[] {
  const out: DraftChange[] = [];
  const before = new Map(a.nodes.map((n) => [n.id, n]));
  const after = new Map(b.nodes.map((n) => [n.id, n]));
  for (const n of b.nodes) {
    const o = before.get(n.id);
    if (!o) {
      out.push({ nodeId: n.id, field: 'node-added', message: `"${n.role}" 단계를 새로 넣어요.` });
      continue;
    }
    nodeChanges(o, n, out);
  }
  for (const n of a.nodes)
    if (!after.has(n.id))
      out.push({ nodeId: n.id, field: 'node-removed', message: `"${n.role}" 단계를 빼요.` });
  if (!same(a.edges, b.edges)) out.push({ field: 'edges', message: '단계를 잇는 순서가 바뀌어요.' });
  if (!same(a.gaps, b.gaps))
    out.push({ field: 'gaps', message: `빈 칸이 ${a.gaps.length}개에서 ${b.gaps.length}개가 돼요.` });
  if (a.name !== b.name || a.command !== b.command || a.displayName !== b.displayName)
    out.push({ field: 'meta', message: `이름이 "${b.displayName}"(${b.command})로 바뀌어요.` });
  return out;
}

function nodeChanges(o: DraftNode, n: DraftNode, out: DraftChange[]) {
  if (o.engine !== n.engine)
    out.push({
      nodeId: n.id,
      field: 'engine',
      message: `"${n.role}"를 맡는 AI가 "${o.engine ?? '자동'}"에서 "${n.engine ?? '자동'}"로 바뀌어요.`,
    });
  if (!same(o.skills, n.skills)) {
    const added = n.skills.filter((s) => !o.skills.includes(s));
    const removed = o.skills.filter((s) => !n.skills.includes(s));
    out.push({
      nodeId: n.id,
      field: 'skills',
      chips: added,
      message:
        `"${n.role}"의 스킬이 바뀌어요.` +
        (added.length ? ` 넣기: ${added.map((s) => `"${s}"`).join(', ')}.` : '') +
        (removed.length ? ` 빼기: ${removed.map((s) => `"${s}"`).join(', ')}.` : ''),
    });
  }
  if (!same(o.tools, n.tools))
    out.push({
      nodeId: n.id,
      field: 'tools',
      chips: n.tools.filter((t) => !o.tools.includes(t)),
      message: `"${n.role}"가 쓰는 도구가 바뀌어요.`,
    });
  if (o.permission !== n.permission)
    out.push({
      nodeId: n.id,
      field: 'permission',
      message: `"${n.role}"의 권한이 "${PERM[n.permission]}"로 바뀌어요.`,
    });
  if (o.role !== n.role)
    out.push({ nodeId: n.id, field: 'role', message: `"${o.role}" 이름이 "${n.role}"로 바뀌어요.` });
}

/** 노란색으로 칠할 노드 id와 칩("노드id:칩") */
export function changedMarks(changes: readonly DraftChange[]): { nodes: Set<string>; chips: Set<string> } {
  const nodes = new Set<string>();
  const chips = new Set<string>();
  for (const c of changes) {
    if (!c.nodeId || c.field === 'node-removed') continue;
    nodes.add(c.nodeId);
    for (const x of c.chips ?? []) chips.add(`${c.nodeId}:${x}`);
  }
  return { nodes, chips };
}
