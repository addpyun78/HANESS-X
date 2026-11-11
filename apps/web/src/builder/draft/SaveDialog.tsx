import type { AgentDraft } from '@harness-x/protocol';
import { useState } from 'react';
import { ApiError } from '../../api/client.js';
import { suggestCommand, validateAgentName } from '../inspector/save.js';
import type { DesignerApi, SaveDraftResponse } from './api.js';
import { act } from '../../actions/registry.js';

/**
 * P4-F.3 저장 확인 창: 요약(쉬운 말) + 이름·명령 최종 수정 + 빈 칸이 있으면
 *   [빈 칸 채우고 저장하기(권장)] [빈 칸 있는 채로 저장 — 실행은 안 됨]
 * P4-F.2 사람이 이 창의 저장 버튼을 누를 때만 1회용 클릭 토큰을 받아 저장 API를 부른다.
 * P4-F.4 이름이 겹치면 서버가 준 다른 이름을 제안한다.
 */

export const FILL_GAPS_LABEL = '빈 칸 채우고 저장하기(권장)';
export const SAVE_INCOMPLETE_LABEL = '빈 칸 있는 채로 저장 — 실행은 안 됨';

export interface SaveDialogProps {
  draftId: string;
  draft: AgentDraft;
  api: Pick<DesignerApi, 'gestureToken' | 'saveAgent'>;
  onClose: () => void;
  /** 빈 칸을 채우러 돌아가기 */
  onFillGaps: () => void;
  onSaved: (r: SaveDraftResponse) => void;
}

export function SaveDialog({ draftId, draft, api, onClose, onFillGaps, onSaved }: SaveDialogProps) {
  const [name, setName] = useState(draft.name);
  const [command, setCommand] = useState(draft.command);
  const [commandTouched, setCommandTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [suggestion, setSuggestion] = useState<{ name: string; command: string }>();
  const nameError = validateAgentName(name) ? '이름은 영어 소문자와 - 만 쓸 수 있어요.' : undefined;
  const gaps = draft.gaps.length;

  const save = async (allowIncomplete: boolean) => {
    if (nameError) return;
    setBusy(true);
    setError(undefined);
    setSuggestion(undefined);
    try {
      // 클릭 한 번 = 토큰 한 개 (60초, 1회용)
      const token = await api.gestureToken('save-agent');
      const r = await api.saveAgent(
        {
          draftId,
          draft: { ...draft, name, command },
          ...(allowIncomplete ? { allowIncomplete: true } : {}),
        },
        token,
      );
      onSaved(r);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as Record<string, unknown> | undefined) : undefined;
      if (body?.error === 'name_taken' && body.suggestion) {
        setSuggestion(body.suggestion as { name: string; command: string });
        setError('이미 있는 이름이에요.');
      } else setError('저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hx-save-dialog" role="dialog" aria-modal="true" aria-label="에이전트 저장">
      <h3 className="hx-draft-card__title">이 에이전트를 저장할까요?</h3>
      <ul className="hx-draft-card__summary">
        {draft.summary
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => (
            <li key={l}>{l}</li>
          ))}
      </ul>
      <label>
        이름
        <input
          aria-label="저장할 이름"
          className="hx-mono"
          value={name}
          aria-invalid={nameError ? true : undefined}
          onChange={(e) => {
            const v = e.target.value.toLowerCase();
            setName(v);
            if (!commandTouched) setCommand(suggestCommand(v));
          }}
        />
      </label>
      <label>
        부르는 말
        <input
          aria-label="저장할 명령"
          className="hx-mono"
          value={command}
          onChange={(e) => {
            setCommandTouched(true);
            setCommand(e.target.value);
          }}
        />
      </label>
      {nameError && <p role="alert">{nameError}</p>}
      {error && (
        <p role="alert">
          {error}
          {suggestion && (
            <>
              {' '}
              "{suggestion.name}"는 어떨까요?{' '}
              <button
                {...act('save.use-suggestion')}
                type="button"
                className="hx-insp-btn hx-insp-btn--ghost"
                onClick={() => {
                  setName(suggestion.name);
                  setCommand(suggestion.command);
                  setSuggestion(undefined);
                  setError(undefined);
                }}
              >
                이 이름 쓰기
              </button>
            </>
          )}
        </p>
      )}
      {gaps > 0 && <p className="hx-draft-card__warn">빈 칸이 {gaps}개 있어요.</p>}
      <div className="hx-draft-card__actions">
        {gaps > 0 ? (
          <>
            <button {...act('save.fill-gaps')} type="button" className="hx-insp-btn" onClick={onFillGaps}>
              {FILL_GAPS_LABEL}
            </button>
            <button
              {...act('save.save-incomplete')}
              type="button"
              className="hx-insp-btn hx-insp-btn--ghost"
              disabled={busy || !!nameError}
              title={busy ? '저장하는 중이에요' : nameError ? '이름을 먼저 고쳐 주세요' : undefined}
              onClick={() => void save(true)}
            >
              {SAVE_INCOMPLETE_LABEL}
            </button>
          </>
        ) : (
          <button
            {...act('save.save')}
            type="button"
            className="hx-insp-btn"
            disabled={busy || !!nameError}
            title={busy ? '저장하는 중이에요' : nameError ? '이름을 먼저 고쳐 주세요' : undefined}
            onClick={() => void save(false)}
          >
            저장
          </button>
        )}
        <button
          {...act('save.close')}
          type="button"
          className="hx-insp-btn hx-insp-btn--ghost"
          onClick={onClose}
        >
          닫기
        </button>
      </div>
    </div>
  );
}
