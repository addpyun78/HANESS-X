import type { Edge, Node } from '@xyflow/react';
import type { BuilderGraph, BuilderGroup, BuilderNode } from './graph.js';
import { GRID } from './graph.js';
import { edgeCompat } from './lego/model.js';

/** 그래프 모델 → React Flow 노드·엣지 (순수 함수) */

export const NODE_W = 12 * GRID;
export const NODE_H = 8 * GRID;
const GROUP_PAD = 2 * GRID;

export type HxNodeData = { node: BuilderNode };
export type HxGroupData = { group: BuilderGroup };
export type HxFlowNode = Node<HxNodeData, 'hxNode'> | Node<HxGroupData, 'hxGroup'>;

/** 그룹 크기: 자식 노드 경계 + 여백 (자식 위치는 그룹 기준) */
export function groupSize(g: BuilderGraph, groupId: string): { width: number; height: number } {
  const kids = g.nodes.filter((n) => n.groupId === groupId);
  const w = Math.max(0, ...kids.map((n) => n.position.x + NODE_W));
  const h = Math.max(0, ...kids.map((n) => n.position.y + NODE_H));
  return { width: w + GROUP_PAD, height: h + GROUP_PAD };
}

export function toFlowNodes(g: BuilderGraph): HxFlowNode[] {
  const sel = new Set(g.selection);
  const groups: HxFlowNode[] = g.groups.map((group) => ({
    id: group.id,
    type: 'hxGroup',
    position: group.position,
    data: { group },
    selected: sel.has(group.id),
    style: groupSize(g, group.id),
    className: 'hx-flow-group',
  }));
  const nodes: HxFlowNode[] = g.nodes.map((node) => ({
    id: node.id,
    type: 'hxNode',
    position: node.position,
    data: { node },
    selected: sel.has(node.id),
    ...(node.groupId ? { parentId: node.groupId, extent: 'parent' as const } : {}),
  }));
  // React Flow: 부모 노드가 자식보다 앞에 와야 한다
  return [...groups, ...nodes];
}

export type HxEdgeData = { compatible: boolean; reason: string; onFail?: boolean };
export type HxFlowEdge = Edge<HxEdgeData, 'hxEdge'>;

/** 엣지: 출력→입력 스키마 정적 검사 결과를 실어 보낸다(비호환이면 빨간 선 + 사유) */
export function toFlowEdges(g: BuilderGraph): HxFlowEdge[] {
  const sel = new Set(g.selection);
  return g.edges.map((e) => {
    const c = edgeCompat(g, e);
    return {
      id: e.id,
      type: 'hxEdge',
      source: e.from,
      target: e.to,
      selected: sel.has(e.id),
      data: { compatible: c.compatible, reason: c.reason, ...(e.onFail ? { onFail: true } : {}) },
      ...(c.compatible ? {} : { className: 'hx-edge--bad' }),
    };
  });
}
