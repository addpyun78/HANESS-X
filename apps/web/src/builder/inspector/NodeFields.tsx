import type { NodePermission, PipelineNodeInput } from '@harness-x/protocol';
import { useEffect, useState } from 'react';
import type { CatalogItem } from '../catalog.js';
import { NODE_LABEL, type BuilderNode } from '../graph.js';
import { skillsOf } from '../lego/model.js';
import { editableFields, parseSchemaText, type InspectorAction, type NodePatch } from './model.js';

const PERMISSIONS: { value: NodePermission; label: string }[] = [
  { value: 'read-only', label: '읽기 전용' },
  { value: 'workspace-write', label: '워크스페이스 쓰기' },
  { value: 'full', label: '전체' },
];

const MODES = [
  { value: 'subscription', label: '구독' },
  { value: 'apiKey', label: 'API 키' },
] as const;

const field = <K extends keyof NodePatch>(spec: PipelineNodeInput, k: K) =>
  (spec as Record<string, unknown>)[k] as NodePatch[K];

export interface NodeFieldsProps {
  node: BuilderNode;
  engines: readonly CatalogItem[];
  dispatch: (a: InspectorAction) => void;
}

/** 46.1 선택 노드 인스펙터: 이름·엔진·인증 모드·권한·스킬 순서·체크리스트 템플릿·입출력 스키마 */
export function NodeFields({ node, engines, dispatch }: NodeFieldsProps) {
  const spec = node.spec;
  const can = new Set(editableFields(spec));
  const patch = (p: NodePatch) => dispatch({ type: 'patchNode', nodeId: node.id, patch: p });
  const skills = skillsOf(spec);
  const engine = field(spec, 'engine') ?? 'auto';

  return (
    <div className="hx-inspector__form" data-node-id={node.id}>
      <p className="hx-inspector__kind">
        <span className="hx-mono">{node.id}</span> · {NODE_LABEL[spec.type]}
      </p>
      <label className="hx-field">
        <span>이름</span>
        <input
          aria-label="노드 이름"
          value={spec.label ?? ''}
          placeholder={node.id}
          onChange={(e) => patch({ label: e.target.value })}
        />
      </label>
      {can.has('engine') && (
        <label className="hx-field">
          <span>엔진</span>
          <select aria-label="노드 엔진" value={engine} onChange={(e) => patch({ engine: e.target.value })}>
            <option value="auto">auto (라우팅)</option>
            {engines.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
            {engine !== 'auto' && !engines.some((x) => x.id === engine) && (
              <option value={engine}>{engine}</option>
            )}
          </select>
        </label>
      )}
      {can.has('mode') && (
        <label className="hx-field">
          <span>인증 모드</span>
          <select
            aria-label="인증 모드"
            value={field(spec, 'mode') ?? 'subscription'}
            onChange={(e) => patch({ mode: e.target.value as NodePatch['mode'] })}
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {can.has('permission') && (
        <label className="hx-field">
          <span>권한</span>
          <select
            aria-label="노드 권한"
            value={field(spec, 'permission') ?? 'workspace-write'}
            onChange={(e) => patch({ permission: e.target.value as NodePermission })}
          >
            {PERMISSIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {spec.type === 'role' && (
        <div className="hx-field">
          <span>스킬 순서</span>
          {skills.length === 0 ? (
            <p className="hx-inspector__empty">끼운 스킬이 없습니다</p>
          ) : (
            <ol className="hx-skill-order" aria-label="스킬 순서">
              {skills.map((s, i) => (
                <li key={s} data-skill={s}>
                  <span className="hx-mono">{s}</span>
                  <button
                    type="button"
                    className="hx-icon-btn"
                    aria-label={`${s} 위로`}
                    disabled={i === 0}
                    onClick={() => dispatch({ type: 'reorderSkill', nodeId: node.id, from: i, to: i - 1 })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="hx-icon-btn"
                    aria-label={`${s} 아래로`}
                    disabled={i === skills.length - 1}
                    onClick={() => dispatch({ type: 'reorderSkill', nodeId: node.id, from: i, to: i + 1 })}
                  >
                    ↓
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {can.has('checklistTemplate') && (
        <label className="hx-field">
          <span>체크리스트 템플릿</span>
          <input
            aria-label="체크리스트 템플릿"
            value={field(spec, 'checklistTemplate') ?? ''}
            placeholder="templates/build.yaml"
            onChange={(e) => patch({ checklistTemplate: e.target.value })}
          />
        </label>
      )}
      {can.has('inputSchema') && (
        <SchemaField
          label="입력 스키마"
          value={field(spec, 'inputSchema')}
          onApply={(v) => patch({ inputSchema: v })}
        />
      )}
      {can.has('outputSchema') && (
        <SchemaField
          label="출력 스키마"
          value={field(spec, 'outputSchema')}
          onApply={(v) => patch({ outputSchema: v })}
        />
      )}
    </div>
  );
}

const show = (v: unknown) => (v === undefined ? '' : JSON.stringify(v, null, 2));

/** JSON 스키마 입력칸: 포커스를 잃을 때 적용, 잘못된 JSON이면 오류 표시 후 적용 안 함 */
function SchemaField({
  label,
  value,
  onApply,
}: {
  label: string;
  value: NodePatch['inputSchema'];
  onApply: (v: NodePatch['inputSchema']) => void;
}) {
  const [text, setText] = useState(() => show(value));
  const [error, setError] = useState<string>();
  useEffect(() => {
    setText(show(value));
    setError(undefined);
  }, [value]);
  return (
    <label className="hx-field">
      <span>{label}</span>
      <textarea
        aria-label={label}
        className="hx-mono"
        rows={4}
        value={text}
        placeholder='{"type":"object","properties":{}}'
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const r = parseSchemaText(text);
          if (!r.ok) return setError(r.error);
          setError(undefined);
          onApply(r.value);
        }}
      />
      {error && (
        <span className="hx-field__error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
