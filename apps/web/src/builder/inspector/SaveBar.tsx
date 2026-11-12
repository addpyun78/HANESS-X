import { useState } from 'react';
import { ApiError, type SaveAgentRequest, type SaveAgentResponse } from '../../api/client.js';
import type { BuilderGraph } from '../graph.js';
import { buildSaveRequest, suggestCommand, toAgentName, validateAgentName, type AgentMeta } from './save.js';
import { act } from '../../actions/registry.js';

export type SaveAgentFn = (
  name: string,
  body: SaveAgentRequest,
  gestureToken: string,
) => Promise<SaveAgentResponse>;
/** P4-F.2 사람 클릭 토큰 받기 (POST /api/gesture-tokens {kind:'save-agent'}) */
export type GestureTokenFn = (kind: 'save-agent') => Promise<string>;

export interface SaveBarProps {
  graph: BuilderGraph;
  meta: AgentMeta;
  onMeta: (m: AgentMeta) => void;
  /** PUT /api/agents/:name (없으면 저장 버튼 비활성) */
  save?: SaveAgentFn;
  /** 저장 클릭 때 먼저 받는 사람 클릭 토큰 (없으면 저장 버튼 비활성) */
  gestureToken?: GestureTokenFn;
  onSaved?: (r: SaveAgentResponse) => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; r: SaveAgentResponse }
  | { kind: 'exists' }
  | { kind: 'error'; message: string };

/** 46.3 저장 줄: 이름 → /명령 자동 제안, 저장 → ~/.harness-x/agents/<이름>/ */
export function SaveBar({ graph, meta, onMeta, save, gestureToken, onSaved }: SaveBarProps) {
  const [commandTouched, setCommandTouched] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const nameError = validateAgentName(meta.name);
  const command = meta.command ?? suggestCommand(meta.name);

  const setName = (raw: string) => {
    const name = raw.toLowerCase();
    onMeta({ ...meta, name, ...(commandTouched ? {} : { command: suggestCommand(name) }) });
  };

  const doSave = async (overwrite: boolean) => {
    if (!save || !gestureToken || nameError || graph.nodes.length === 0) return;
    setStatus({ kind: 'saving' });
    try {
      // P4-F.2: 클릭마다 새 1회용 토큰 → 저장 (세션 토큰만으로는 저장 못 함)
      const token = await gestureToken('save-agent');
      const r = await save(meta.name, buildSaveRequest(graph, { ...meta, command }, overwrite), token);
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
        {...act('inspector.save')}
        type="submit"
        className="hx-insp-btn"
        disabled={
          !save || !gestureToken || !!nameError || graph.nodes.length === 0 || status.kind === 'saving'
        }
        title={
          status.kind === 'saving'
            ? '저장하는 중이에요'
            : graph.nodes.length === 0
              ? '블록을 하나 이상 놓아 주세요'
              : nameError
                ? '이름을 먼저 고쳐 주세요'
                : !save || !gestureToken
                  ? '저장할 곳에 연결되지 않았어요'
                  : undefined
        }
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
              {...act('inspector.overwrite')}
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
