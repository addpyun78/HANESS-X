import { useState } from 'react';
import type { BuilderCatalog } from './catalog.js';
import type { StartChoice as Choice } from './start.js';
import { act } from '../actions/registry.js';

export interface StartChoiceProps {
  catalog: BuilderCatalog;
  onChoose: (c: Choice) => void;
}

type Mode = 'menu' | 'plugin' | 'clone';

/** 빌더 첫 화면: 어디서 시작할지 고른다 */
export function StartChoice({ catalog, onChoose }: StartChoiceProps) {
  const [mode, setMode] = useState<Mode>('menu');
  return (
    <section className="hx-start" aria-label="시작 선택">
      <h2 className="hx-start__title">새 에이전트 — 어디서 시작할까요?</h2>
      <div className="hx-start__options" role="group" aria-label="시작 방법">
        <button
          {...act('builder.start-empty')}
          type="button"
          className="hx-start__option"
          onClick={() => onChoose({ kind: 'empty' })}
        >
          <strong>빈 캔버스</strong>
          <span>노드를 하나씩 끌어다 놓습니다</span>
        </button>
        <button
          {...act('builder.start-plugin-list')}
          type="button"
          className="hx-start__option"
          aria-pressed={mode === 'plugin'}
          onClick={() => setMode('plugin')}
        >
          <strong>플러그인에서 시작</strong>
          <span>플러그인 파이프라인을 펼쳐 고칩니다</span>
        </button>
        <button
          {...act('builder.start-clone-list')}
          type="button"
          className="hx-start__option"
          aria-pressed={mode === 'clone'}
          onClick={() => setMode('clone')}
        >
          <strong>기존 에이전트 복제</strong>
          <span>등록된 에이전트를 복사해 고칩니다</span>
        </button>
        <button
          {...act('builder.start-chat')}
          type="button"
          className="hx-start__option"
          onClick={() => onChoose({ kind: 'chat' })}
        >
          <strong>말이나 글로 설명해서 만들기</strong>
          <span>AI에게 원하는 에이전트를 설명하면 초안을 만들어 줘요</span>
        </button>
      </div>
      {mode === 'plugin' && (
        <ul className="hx-start__list" aria-label="플러그인 목록">
          {catalog.plugins.map((p) => (
            <li key={p.id}>
              <button
                {...act('builder.start-plugin')}
                type="button"
                disabled={!p.pipeline}
                title={p.pipeline ? undefined : '파이프라인을 불러올 수 없습니다'}
                onClick={() => onChoose({ kind: 'plugin', pluginId: p.id })}
              >
                {p.label}
                {p.description && <span className="hx-start__desc">{p.description}</span>}
              </button>
            </li>
          ))}
          {catalog.plugins.length === 0 && (
            <li className="hx-start__empty">파이프라인 플러그인이 없습니다</li>
          )}
        </ul>
      )}
      {mode === 'clone' && (
        <ul className="hx-start__list" aria-label="에이전트 목록">
          {catalog.agents.map((a) => (
            <li key={a.id}>
              <button
                {...act('builder.start-clone')}
                type="button"
                disabled={!a.pipeline}
                title={a.pipeline ? undefined : '파이프라인을 불러올 수 없습니다'}
                onClick={() => onChoose({ kind: 'clone', agentId: a.id })}
              >
                {a.icon && <span aria-hidden="true">{a.icon} </span>}
                {a.label}
                {a.nodeCount !== undefined && <span className="hx-start__desc">노드 {a.nodeCount}개</span>}
              </button>
            </li>
          ))}
          {catalog.agents.length === 0 && <li className="hx-start__empty">등록된 에이전트가 없습니다</li>}
        </ul>
      )}
    </section>
  );
}
