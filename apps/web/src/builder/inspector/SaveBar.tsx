import { useState } from 'react';
import { ApiError, type SaveAgentRequest, type SaveAgentResponse } from '../../api/client.js';
import type { BuilderGraph } from '../graph.js';
import { buildSaveRequest, suggestCommand, toAgentName, validateAgentName, type AgentMeta } from './save.js';

export type SaveAgentFn = (name: string, body: SaveAgentRequest) => Promise<SaveAgentResponse>;

export interface SaveBarProps {
  graph: BuilderGraph;
  meta: AgentMeta;
  onMeta: (m: AgentMeta) => void;
  /** PUT /api/agents/:name (없으면 저장 버튼 비활성) */
  save?: SaveAgentFn;
  onSaved?: (r: SaveAgentResponse) => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; r: SaveAgentResponse }
  | { kind: 'exists' }
  | { kind: 'error'; message: string };

/** 46.3 저장 줄: 이름 → /명령 자동 제안, 저장 → ~/.harness-x/agents/<이름>/ */
export function SaveBar({ graph, meta, onMeta, save, onSaved }: SaveBarProps) {
  const [commandTouched, setCommandTouched] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const nameError = validateAgentName(meta.name);
  const command = meta.command ?? suggestCommand(meta.name);

  const setName = (raw: string) => {
    const name = raw.toLowerCase();
    onMeta({ ...meta, name, ...(commandTouched ? {} : { command: suggestCommand(name) }) });
  };

  const doSave = async (overwrite: boolean) => {
    if (!save || nameError || graph.nodes.length === 0) return;
    setStatus({ kind: 'saving' });
    try {
      const r = await save(meta.name, buildSaveRequest(graph, { ...meta, command }, overwrite));
      setStatus({ kind: 'saved', r });
      onSaved?.(r);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) return setStatus({ kind: 'exists' });
      const body =
        err instanceof ApiError ? (err.body as { message?: string; errors?: string[] }) : undefined;
      setStatus({
        kind: 'error',
        message:
          body?.errors?.join('; ') ?? body?.message ?? (err instanceof Error ? err.message : String(err)),
      });
    }
  };

  return (
    <form
      className="hx-savebar"
      aria-label="에이전트 저장"
      onSubmit={(e) => {
        e.preventDefault();
        void doSave(false);
      }}
    >
      <input
        aria-label="아이콘"
        className="hx-savebar__icon"
        value={meta.icon ?? ''}
        placeholder="✦"
        maxLength={4}
        onChange={(e) => onMeta({ ...meta, icon: e.target.value })}
      />
      <input
        aria-label="표시 이름"
        value={meta.displayName}
        placeholder="표시 이름"
        onChange={(e) => onMeta({ ...meta, displayName: e.target.value })}
        onBlur={() => {
          if (!meta.name || meta.name === 'new-agent') setName(toAgentName(meta.displayName));
        }}
      />
      <input
        aria-label="에이전트 이름"
        className="hx-mono"
        value={meta.name}
        aria-invalid={nameError ? true : undefined}
        title={nameError}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        aria-label="슬래시 명령"
        className="hx-mono"
        value={command}
        onChange={(e) => {
          setCommandTouched(true);
          onMeta({ ...meta, command: e.target.value });
        }}
      />
      <button
        type="submit"
        className="hx-insp-btn"
        disabled={!save || !!nameError || graph.nodes.length === 0 || status.kind === 'saving'}
      >
        저장
      </button>
      <span className="hx-savebar__status" role="status">
        {status.kind === 'saving' && '저장 중…'}
        {status.kind === 'saved' && `저장됨 · ${status.r.command}로 부를 수 있습니다`}
        {status.kind === 'error' && status.message}
        {status.kind === 'exists' && (
          <>
            이미 있는 이름입니다{' '}
            <button
              type="button"
              className="hx-insp-btn hx-insp-btn--ghost"
              onClick={() => void doSave(true)}
            >
              덮어쓰기
            </button>
          </>
        )}
      </span>
    </form>
  );
}
