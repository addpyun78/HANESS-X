import type { BuilderGraph } from './graph.js';
import { NODE_LABEL } from './graph.js';

/** 인스펙터(우): 선택한 노드 요약 (편집은 T-046 inspector/) */
export function Inspector({ graph }: { graph: BuilderGraph }) {
  const node = graph.nodes.find((n) => graph.selection.includes(n.id));
  return (
    <aside className="hx-inspector" aria-label="인스펙터">
      <h3 className="hx-inspector__title">인스펙터</h3>
      {node ? (
        <dl className="hx-inspector__fields">
          <dt>id</dt>
          <dd className="hx-mono">{node.id}</dd>
          <dt>종류</dt>
          <dd>{NODE_LABEL[node.spec.type]}</dd>
          <dt>이름</dt>
          <dd>{node.spec.label ?? node.id}</dd>
          {'engine' in node.spec && (
            <>
              <dt>엔진</dt>
              <dd>{node.spec.engine ?? 'auto'}</dd>
            </>
          )}
          {'skills' in node.spec && (
            <>
              <dt>스킬</dt>
              <dd>{node.spec.skills?.length ? node.spec.skills.join(', ') : '없음'}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="hx-inspector__empty">노드를 선택하세요</p>
      )}
      <p className="hx-inspector__count">
        노드 {graph.nodes.length}개 · 연결 {graph.edges.length}개
      </p>
    </aside>
  );
}
