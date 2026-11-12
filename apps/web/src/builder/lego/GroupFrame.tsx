import type { NodeProps } from '@xyflow/react';
import type { HxFlowNode } from '../flow.js';
import { useLegoDispatch } from './dnd.js';
import { act } from '../../actions/registry.js';

type Props = NodeProps<Extract<HxFlowNode, { type: 'hxGroup' }>>;

/** 플러그인 그룹(점선 틀): 틀을 잡으면 안의 노드가 통째로 움직이고, × 로 통째로 떼어낸다 */
export function GroupFrame({ data, selected }: Props) {
  const dispatch = useLegoDispatch();
  const { group } = data;
  return (
    <div
      className="hx-group"
      data-group-id={group.id}
      data-plugin={group.pluginId}
      data-selected={selected || undefined}
    >
      <div className="hx-group__head">
        <span className="hx-group__label">⧉ {group.label}</span>
        <button
          {...act('lego.detach-plugin')}
          type="button"
          className="hx-group__detach nodrag"
          aria-label={`${group.label} 플러그인 떼어내기`}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ type: 'detachGroup', id: group.id });
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
