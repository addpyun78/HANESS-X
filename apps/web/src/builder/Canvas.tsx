import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import type { NodeType } from '@harness-x/protocol';
import { useCallback, useMemo, type DragEvent } from 'react';
import { BLOCK_MIME } from './catalog.js';
import { readBlock } from './Drawer.js';
import { toFlowEdges, toFlowNodes } from './flow.js';
import { GRID, type BuilderGraph, type GraphAction } from './graph.js';
import { NodeView } from './NodeView.js';

export interface CanvasProps {
  graph: BuilderGraph;
  dispatch: (a: GraphAction) => void;
}

const nodeTypes = { hxNode: NodeView };

/** 캔버스(중): React Flow, 16px 스냅 그리드. 서랍 블록을 끌어 놓으면 노드가 생긴다 */
export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ graph, dispatch }: CanvasProps) {
  const rf = useReactFlow();
  const nodes = useMemo(() => toFlowNodes(graph), [graph]);
  const edges = useMemo(() => toFlowEdges(graph), [graph]);

  const onDragOver = (e: DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes(BLOCK_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (e: DragEvent) => {
    const block = readBlock(e.dataTransfer);
    if (!block) return;
    e.preventDefault();
    const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (block.kind === 'node') dispatch({ type: 'addNode', nodeType: block.id as NodeType, position });
  };

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes)
        if (c.type === 'position' && c.position)
          dispatch({ type: 'moveNode', id: c.id, position: c.position });
    },
    [dispatch],
  );

  const onSelectionChange = useCallback(
    ({ nodes: ns, edges: es }: OnSelectionChangeParams) =>
      dispatch({ type: 'select', ids: [...ns.map((n) => n.id), ...es.map((x) => x.id)] }),
    [dispatch],
  );

  return (
    <div
      className="hx-canvas"
      aria-label="캔버스"
      role="region"
      data-node-count={graph.nodes.length}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        snapToGrid
        snapGrid={[GRID, GRID]}
        deleteKeyCode={null}
        fitView={graph.nodes.length > 0}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {graph.nodes.length === 0 && (
        <p className="hx-canvas__hint">왼쪽 서랍에서 노드 블록을 끌어다 놓으세요</p>
      )}
    </div>
  );
}
