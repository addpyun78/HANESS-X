import { AI_MODE_LABEL, aiChoiceMode, setAiChoiceMode, type AiChoiceMode } from '../ai-choice.js';
import type { BuilderGraph } from '../graph.js';
import type { InspectorAction } from './model.js';

export interface AiChoiceFieldProps {
  graph: Pick<BuilderGraph, 'nodes'>;
  /** 지금 메인 AI 엔진 (직접 고르기로 바꿀 때 따라가던 노드를 이 엔진으로 고정) */
  mainEngine?: string | undefined;
  dispatch: (a: InspectorAction) => void;
}

/** T-101 5D.2 에이전트 설정 "AI 고르는 방식" — 메인 AI 따라가기(기본) / 노드마다 직접 고르기 */
export function AiChoiceField({ graph, mainEngine, dispatch }: AiChoiceFieldProps) {
  const mode = aiChoiceMode(graph);
  const change = (next: AiChoiceMode) => {
    if (next === mode) return;
    const after = setAiChoiceMode(graph, next, mainEngine);
    after.nodes.forEach((n, i) => {
      const before = graph.nodes[i]?.spec as { engine?: string } | undefined;
      const engine = (n.spec as { engine?: string }).engine;
      if (engine && before?.engine !== engine) dispatch({ type: 'setEngine', nodeId: n.id, engine });
    });
  };
  return (
    <fieldset className="hx-inspector__field" role="radiogroup" aria-label="AI 고르는 방식">
      <legend>AI 고르는 방식</legend>
      {(Object.keys(AI_MODE_LABEL) as AiChoiceMode[]).map((m) => (
        <label key={m}>
          <input
            type="radio"
            name="ai-choice-mode"
            aria-label={AI_MODE_LABEL[m]}
            checked={mode === m}
            onChange={() => change(m)}
          />
          {AI_MODE_LABEL[m]}
          {m === 'follow-main' ? ' (기본 — 메인을 바꾸면 같이 바뀜)' : ''}
        </label>
      ))}
    </fieldset>
  );
}
