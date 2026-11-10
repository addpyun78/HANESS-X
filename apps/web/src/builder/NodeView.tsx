import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { HxFlowNode } from './flow.js';
import { NODE_LABEL } from './graph.js';

type Props = NodeProps<Extract<HxFlowNode, { type: 'hxNode' }>>;

/** 캔버스 위 노드 카드: 종류·이름·엔진 칩·스킬 칩, 좌(입력)·우(출력) 포트 */
export function NodeView({ data, selected }: Props) {
  const { node } = data;
  const spec = node.spec;
  const engine = 'engine' in spec ? spec.engine : undefined;
  const skills = 'skills' in spec ? (spec.skills ?? []) : [];
  return (
    <div
      className="hx-node"
      data-node-id={node.id}
      data-node-type={spec.type}
      data-selected={selected || undefined}
    >
      <Handle type="target" position={Position.Left} className="hx-port hx-port--in" />
      <div className="hx-node__head">
        <span className="hx-node__type">{NODE_LABEL[spec.type]}</span>
        <span className="hx-node__label">{spec.label ?? spec.id}</span>
      </div>
      {engine !== undefined && (
        <span className="hx-engine-chip" data-engine={engine}>
          {engine}
        </span>
      )}
      {skills.length > 0 && (
        <ul className="hx-skill-chips" aria-label={`${spec.label ?? spec.id} 스킬`}>
          {skills.map((s) => (
            <li key={s} className="hx-skill-chip">
              {s}
            </li>
          ))}
        </ul>
      )}
      <Handle type="source" position={Position.Right} className="hx-port hx-port--out" />
    </div>
  );
}
