import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import type { NodeType } from '@harness-x/protocol';
import { useCallback, useMemo, type DragEvent, type ReactNode } from 'react';
import { BLOCK_MIME, type BuilderCatalog } from './catalog.js';
import { readBlock } from './Drawer.js';
import { toFlowEdges, toFlowNodes } from './flow.js';
import { GRID, type BuilderGraph } from './graph.js';
import { CompatEdge } from './lego/CompatEdge.js';
import { CHIP_MIME, hasType, LegoDispatch, readChip } from './lego/dnd.js';
import { GroupFrame } from './lego/GroupFrame.js';
import { LegoNode } from './lego/LegoNode.js';
import type { LegoAction } from './lego/model.js';

export interface CanvasProps {
  graph: BuilderGraph;
  catalog: BuilderCatalog;
  /** 그래프 동작 + 'checkpoint'(끌기 시작 = 실행 취소 한 단계) */
  dispatch: (a: LegoAction | { type: 'checkpoint' }) => void;
  /** 캔버스 위에 겹쳐 그릴 것 (초안 빈 칸 — T-100 P4-C.10) */
  children?: ReactNode;
}

const nodeTypes = { hxNode: LegoNode, hxGroup: GroupFrame };
const edgeTypes = { hxEdge: CompatEdge };

/** 캔버스(중): React Flow, 16px 스냅 그리드. 서랍 블록을 끌어 놓으면 노드·플러그인 그룹이 생긴다 */
export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <LegoDispatch.Provider value={props.dispatch}>
        <CanvasInner {...props} />
      </LegoDispatch.Provider>
    </ReactFlowProvider>
  );
}

function CanvasInner({ graph, catalog, dispatch, children }: CanvasProps) {
  const rf = useReactFlow();
  const nodes = useMemo(() => toFlowNodes(graph), [graph]);
  const edges = useMemo(() => toFlowEdges(graph), [graph]);
  const groupIds = useMemo(() => new Set(graph.groups.map((g) => g.id)), [graph.groups]);

  const onDragOver = (e: DragEvent) => {
    const dt = e.dataTransfer;
    if (!hasType(dt, BLOCK_MIME) && !hasType(dt, CHIP_MIME)) return;
    e.preventDefault();
    dt.dropEffect = hasType(dt, CHIP_MIME) ? 'move' : 'copy';
  };

  const onDrop = (e: DragEvent) => {
    // 칩을 노드 밖(빈 캔버스)에 놓으면 분리
    const chip = readChip(e.dataTransfer);
    if (chip) {
      e.preventDefault();
      dispatch({ type: 'detachSkill', nodeId: chip.nodeId, skill: chip.skill });
      return;
    }
    const block = readBlock(e.dataTransfer);
    if (!block) return;
    e.preventDefault();
    const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (block.kind === 'node') dispatch({ type: 'addNode', nodeType: block.id as NodeType, position });
    if (block.kind === 'plugin') {
      const p = catalog.plugins.find((x) => x.id === block.id);
      if (p?.pipeline)
        dispatch({ type: 'addPlugin', pluginId: p.id, label: p.label, pipeline: p.pipeline, position });
    }
  };

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type !== 'position' || !c.position) continue;
        dispatch(
          groupIds.has(c.id)
            ? { type: 'moveGroup', id: c.id, position: c.position }
            : { type: 'moveNode', id: c.id, position: c.position },
        );
      }
    },
    [dispatch, groupIds],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) if (c.type === 'remove') dispatch({ type: 'disconnect', id: c.id });
    },
    [dispatch],
  );

  const onConnect = useCallback(
    (c: Connection) => dispatch({ type: 'connect', from: c.source, to: c.target }),
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
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={() => dispatch({ type: 'checkpoint' })}
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
      {children}
    </div>
  );
}
