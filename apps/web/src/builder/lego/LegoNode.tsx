import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useState, type DragEvent } from 'react';
import { blockKindMime } from '../catalog.js';
import { readBlock } from '../Drawer.js';
import type { HxFlowNode } from '../flow.js';
import { NODE_LABEL } from '../graph.js';
import { CHIP_MIME, hasType, readChip, useLegoDispatch } from './dnd.js';
import { acceptsEngine, acceptsSkills, skillsOf } from './model.js';

type Props = NodeProps<Extract<HxFlowNode, { type: 'hxNode' }>>;
type Highlight = 'skill' | 'engine';

/**
 * 역할 노드 카드(레고): 스킬 블록·칩을 놓으면 스킬 칩으로 끼워지고, 엔진 블록을 놓으면 엔진이 바뀐다.
 * 칩의 × 또는 칩을 노드 밖으로 끌어내면 빠진다.
 */
export function LegoNode({ data, selected }: Props) {
  const dispatch = useLegoDispatch();
  const [highlight, setHighlight] = useState<Highlight>();
  const { node } = data;
  const spec = node.spec;
  const engine = 'engine' in spec ? spec.engine : undefined;
  const skills = skillsOf(spec);
  const name = spec.label ?? spec.id;

  const accepts = (dt: DataTransfer | null): Highlight | undefined => {
    if (acceptsSkills(spec) && (hasType(dt, blockKindMime('skill')) || hasType(dt, CHIP_MIME)))
      return 'skill';
    if (acceptsEngine(spec) && hasType(dt, blockKindMime('engine'))) return 'engine';
    return undefined;
  };

  const onDragOver = (e: DragEvent) => {
    const k = accepts(e.dataTransfer);
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = hasType(e.dataTransfer, CHIP_MIME) ? 'move' : 'copy';
    setHighlight(k);
  };

  const onDrop = (e: DragEvent) => {
    setHighlight(undefined);
    if (!accepts(e.dataTransfer)) return;
    const chip = readChip(e.dataTransfer);
    const block = readBlock(e.dataTransfer);
    e.preventDefault();
    e.stopPropagation();
    if (chip) dispatch({ type: 'moveSkill', from: chip.nodeId, to: node.id, skill: chip.skill });
    else if (block?.kind === 'skill') dispatch({ type: 'attachSkill', nodeId: node.id, skill: block.id });
    else if (block?.kind === 'engine') dispatch({ type: 'setEngine', nodeId: node.id, engine: block.id });
  };

  return (
    <div
      className="hx-node"
      data-node-id={node.id}
      data-node-type={spec.type}
      data-selected={selected || undefined}
      data-highlight={highlight}
      onDragOver={onDragOver}
      onDragLeave={() => setHighlight(undefined)}
      onDrop={onDrop}
    >
      <Handle type="target" position={Position.Left} className="hx-port hx-port--in" />
      <div className="hx-node__head">
        <span className="hx-node__type">{NODE_LABEL[spec.type]}</span>
        <span className="hx-node__label">{name}</span>
      </div>
      {engine !== undefined && (
        <span className="hx-engine-chip" data-engine={engine} aria-label={`${name} 엔진 ${engine}`}>
          {engine}
        </span>
      )}
      {acceptsSkills(spec) && (
        <ul className="hx-skill-chips" aria-label={`${name} 스킬`}>
          {skills.map((s) => (
            <li
              key={s}
              className="hx-skill-chip nodrag"
              draggable
              data-skill={s}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData(CHIP_MIME, JSON.stringify({ nodeId: node.id, skill: s }));
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={(e) => {
                // 노드가 받지 않은 곳(캔버스 바깥 등)에 놓으면 분리
                if (e.dataTransfer?.dropEffect === 'none')
                  dispatch({ type: 'detachSkill', nodeId: node.id, skill: s });
              }}
            >
              {s}
              <button
                type="button"
                className="hx-skill-chip__x nodrag"
                aria-label={`${s} 스킬 빼기`}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'detachSkill', nodeId: node.id, skill: s });
                }}
              >
                ×
              </button>
            </li>
          ))}
          {skills.length === 0 && <li className="hx-skill-chips__empty">스킬을 끌어다 놓으세요</li>}
        </ul>
      )}
      <Handle type="source" position={Position.Right} className="hx-port hx-port--out" />
    </div>
  );
}
