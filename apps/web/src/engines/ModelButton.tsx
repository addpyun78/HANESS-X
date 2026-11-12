import type { ModelOption } from '@harness-x/protocol';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AUTH_BADGE,
  choiceLabel,
  groupModels,
  mainAiStatus,
  PICK_OTHER,
  SCOPE_LABEL,
  type AiChoice,
  type ChoiceScope,
} from './model.js';
import './engines.css';
import { act } from '../actions/registry.js';

export interface ModelButtonProps {
  models: readonly ModelOption[];
  /** 지금 이 입력창이 쓰는 AI (세션 → 프로젝트 기본 → 메인 순으로 정해진 것) */
  current: AiChoice | undefined;
  /** current가 어디서 왔나 — project면 "이 프로젝트 기본" 표시 */
  from?: 'session' | 'project' | 'main' | 'none';
  /** "이 프로젝트 기본으로"를 보일지 (프로젝트가 열려 있을 때) */
  hasProject?: boolean;
  /** 고른 AI + 적용 범위 (기본 선택: 모든 곳 기본(메인)) */
  onChoose: (c: AiChoice, scope: ChoiceScope) => void;
  /** 5C.2 [로그인] — 터미널 패널에서 공식 로그인 명령 */
  onLogin?: (engineId: string) => void;
}

/**
 * 5C 입력창 아래 줄 오른쪽(전송 버튼 왼쪽) `[엔진 · 모델 ▾]` — 고른 것이 메인 AI.
 * 펼침 목록: 엔진별 묶음, 모델마다 [구독]/[API]/[무료 로컬] 배지, 이미지 가능 아이콘,
 * 로그인이 필요한 모델은 흐리게 + [로그인]. 고르면 작은 선택 [모든 곳 기본(메인)으로] [이 프로젝트 기본으로] [이 세션만].
 */
export function ModelButton({ models, current, from, hasProject, onChoose, onLogin }: ModelButtonProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<AiChoice>();
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const status = mainAiStatus(current, models);
  const warn = status === 'missing' || status === 'needs-login';
  const close = useCallback(() => {
    setOpen(false);
    setPicked(undefined);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const choose = (scope: ChoiceScope) => {
    if (picked) onChoose(picked, scope);
    close();
  };

  const scopes: ChoiceScope[] = hasProject ? ['main', 'project', 'session'] : ['main', 'session'];
  const label = choiceLabel(current);
  return (
    <div className="hx-chip-wrap hx-model-btn" ref={ref} data-slot="model">
      {warn && (
        <span className="hx-model-warn" role="status">
          ⚠ {PICK_OTHER}
        </span>
      )}
      <button
        type="button"
        className="hx-chip"
        {...act('model.open')}
        aria-label={`AI: ${label}${from === 'project' ? ' (이 프로젝트 기본)' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-warn={warn || undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span>{label}</span>
        {from === 'project' && <span className="hx-model-btn__project">이 프로젝트 기본</span>}
        <span className="hx-chip__caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="hx-model-menu" role="menu" id={menuId} aria-label="AI 고르기">
          {models.length === 0 && <p className="hx-popover__empty">쓸 수 있는 AI를 못 찾았어요</p>}
          {groupModels(models).map((g) => (
            <div key={g.engineId} role="group" aria-label={g.label}>
              <p className="hx-model-menu__group">{g.label}</p>
              {g.models.map((m) => {
                const needsLogin = m.status === 'needs-login';
                const unusable = m.status !== 'ready';
                const selected = current?.engine === m.engineId && current?.model === m.modelId;
                return (
                  <div key={m.modelId} className="hx-model-menu__row">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      aria-disabled={unusable || undefined}
                      {...act('model.choose')}
                      {...(unusable ? { title: '지금은 이 AI를 쓸 수 없어요' } : {})}
                      className="hx-model-menu__item"
                      data-status={m.status}
                      onClick={() => {
                        if (unusable) return;
                        setPicked({ engine: m.engineId, model: m.modelId });
                      }}
                    >
                      <span className="hx-popover__check" aria-hidden="true">
                        {selected ? '✓' : ''}
                      </span>
                      <span>{m.displayName}</span>
                      <span className="hx-model-badge" data-auth={m.auth}>
                        {AUTH_BADGE[m.auth]}
                      </span>
                      {m.inputs.image && (
                        <span title="이미지를 볼 수 있어요" aria-label="이미지 가능">
                          🖼
                        </span>
                      )}
                    </button>
                    {needsLogin && onLogin && (
                      <button
                        type="button"
                        className="hx-icon-btn"
                        {...act('model.login')}
                        onClick={() => onLogin(m.engineId)}
                      >
                        로그인
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {picked && (
            <div className="hx-model-menu__scope" role="group" aria-label="어디에 쓸까요">
              {scopes.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className="hx-icon-btn"
                  {...act('model.scope')}
                  data-default={i === 0 || undefined}
                  autoFocus={i === 0}
                  onClick={() => choose(s)}
                >
                  {SCOPE_LABEL[s]}
                  {i === 0 ? ' (기본)' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
