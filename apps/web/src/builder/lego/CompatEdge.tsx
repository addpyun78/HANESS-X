import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { HxFlowEdge } from '../flow.js';

/** 연결선: 출력→입력 스키마가 맞지 않으면 빨간 선 + 사유 툴팁 */
export function CompatEdge(p: EdgeProps<HxFlowEdge>) {
  const [path, lx, ly] = getBezierPath(p);
  const bad = p.data?.compatible === false;
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        className={bad ? 'hx-edge hx-edge--bad' : 'hx-edge'}
        {...(p.markerEnd ? { markerEnd: p.markerEnd } : {})}
      />
      {(bad || p.data?.onFail) && (
        <EdgeLabelRenderer>
          <div
            className={bad ? 'hx-edge__badge hx-edge__badge--bad' : 'hx-edge__badge'}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            title={bad ? p.data?.reason : '게이트 실패 시 되돌림'}
            role={bad ? 'img' : undefined}
            aria-label={bad ? p.data?.reason : undefined}
          >
            {bad ? '⚠ 비호환' : '실패 시'}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
