import { useState, type ReactNode } from 'react';
import type { BuilderCatalog } from '../catalog.js';
import type { BuilderGraph } from '../graph.js';
import { DryRunTab } from './DryRunTab.js';
import type { Overlay } from './dryrun.js';
import type { InspectorAction } from './model.js';
import { NodeFields } from './NodeFields.js';
import { YamlTab } from './YamlTab.js';
import type { PipelineMeta } from './yaml.js';

export type InspectorTab = 'node' | 'yaml' | 'dryrun';
const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'node', label: '노드' },
  { id: 'yaml', label: 'YAML 보기' },
  { id: 'dryrun', label: '시험 실행' },
];

export interface InspectorPanelProps {
  graph: BuilderGraph;
  catalog: BuilderCatalog;
  meta: PipelineMeta;
  defaultEngine?: string;
  dispatch: (a: InspectorAction) => void;
  onMeta: (m: PipelineMeta) => void;
  overlay: Overlay | undefined;
  onOverlay: (o: Overlay | undefined) => void;
  dryRunStepMs?: number;
  /** 초안 노드별 "AI가 이렇게 정한 이유" (T-100 P4-D.4) */
  reasons?: Record<string, string>;
  /** 초안 저장 전 점검표 등 아래에 붙는 것 (T-100 P4-D.6) */
  footer?: ReactNode;
}

/** 인스펙터(우): 노드 / YAML 보기 / 시험 실행 */
export function InspectorPanel(p: InspectorPanelProps) {
  const [tab, setTab] = useState<InspectorTab>('node');
  const node = p.graph.nodes.find((n) => p.graph.selection.includes(n.id));
  return (
    <aside className="hx-inspector" aria-label="인스펙터">
      <div className="hx-inspector__tabs" role="tablist" aria-label="인스펙터 탭">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="hx-inspector__tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'node' &&
        (node ? (
          <>
            {p.reasons?.[node.id] && (
              <section className="hx-draft-reason" aria-label="AI가 이렇게 정한 이유">
                <h4>AI가 이렇게 정한 이유</h4>
                <p>{p.reasons[node.id]}</p>
              </section>
            )}
            <NodeFields node={node} engines={p.catalog.engines} dispatch={p.dispatch} />
          </>
        ) : (
          <p className="hx-inspector__empty">노드를 선택하세요</p>
        ))}
      {tab === 'yaml' && <YamlTab graph={p.graph} meta={p.meta} dispatch={p.dispatch} onMeta={p.onMeta} />}
      {tab === 'dryrun' && (
        <DryRunTab
          graph={p.graph}
          meta={p.meta}
          overlay={p.overlay}
          onOverlay={p.onOverlay}
          {...(p.defaultEngine ? { defaultEngine: p.defaultEngine } : {})}
          {...(p.dryRunStepMs !== undefined ? { stepMs: p.dryRunStepMs } : {})}
        />
      )}
      {p.footer}
      <p className="hx-inspector__count">
        노드 {p.graph.nodes.length}개 · 연결 {p.graph.edges.length}개
      </p>
    </aside>
  );
}
