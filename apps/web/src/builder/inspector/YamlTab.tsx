import { useEffect, useMemo, useState } from 'react';
import type { BuilderGraph } from '../graph.js';
import type { InspectorAction } from './model.js';
import { graphFromYaml, graphToYaml, type PipelineMeta } from './yaml.js';
import { act } from '../../actions/registry.js';

export interface YamlTabProps {
  graph: BuilderGraph;
  meta: PipelineMeta;
  dispatch: (a: InspectorAction) => void;
  onMeta: (m: PipelineMeta) => void;
}

/** 46.2 "YAML 보기": 그래프 → YAML(자동 갱신), YAML 편집 → "그래프에 적용" */
export function YamlTab({ graph, meta, dispatch, onMeta }: YamlTabProps) {
  const yaml = useMemo(() => (graph.nodes.length ? graphToYaml(graph, meta) : ''), [graph, meta]);
  const [draft, setDraft] = useState(yaml);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (!dirty) setDraft(yaml);
  }, [yaml, dirty]);

  const apply = () => {
    const r = graphFromYaml(draft, graph);
    if (!r.ok) return setErrors(r.errors);
    setErrors([]);
    setDirty(false);
    onMeta(r.meta);
    dispatch({ type: 'loadYaml', text: draft });
  };

  return (
    <div className="hx-yaml">
      <textarea
        aria-label="pipeline.yaml"
        className="hx-yaml__text hx-mono"
        spellCheck={false}
        value={draft}
        placeholder="노드를 캔버스에 놓으면 pipeline.yaml이 여기에 나타납니다"
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
        }}
      />
      <div className="hx-yaml__bar">
        <button
          {...act('inspector.yaml-apply')}
          type="button"
          className="hx-insp-btn"
          disabled={!dirty}
          title={dirty ? undefined : '고친 내용이 없어요'}
          onClick={apply}
        >
          그래프에 적용
        </button>
        <button
          {...act('inspector.yaml-reset')}
          type="button"
          className="hx-insp-btn hx-insp-btn--ghost"
          disabled={!dirty}
          title={dirty ? undefined : '고친 내용이 없어요'}
          onClick={() => {
            setDirty(false);
            setErrors([]);
            setDraft(yaml);
          }}
        >
          되돌리기
        </button>
      </div>
      {errors.length > 0 && (
        <ul className="hx-yaml__errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
