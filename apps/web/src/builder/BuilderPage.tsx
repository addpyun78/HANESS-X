import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { HarnessApiClient, resolveToken } from '../api/client.js';
import { navigate } from '../router.js';
import { Canvas } from './Canvas.js';
import { DEFAULT_CATALOG, loadCatalog, type BuilderCatalog } from './catalog.js';
import { BuilderSidebar } from './chat/BuilderSidebar.js';
import { resolveStt, type SttHandle } from './chat/stt.js';
import { emptyGraph } from './graph.js';
import { InspectorPanel } from './inspector/InspectorPanel.js';
import type { Overlay } from './inspector/dryrun.js';
import { inspectorReducer } from './inspector/model.js';
import { RunOverlayContext } from './inspector/overlay-context.js';
import { mergePipelineMeta, suggestCommand, type AgentMeta } from './inspector/save.js';
import { SaveBar, type SaveAgentFn } from './inspector/SaveBar.js';
import type { PipelineMeta } from './inspector/yaml.js';
import { canRedo, canUndo, initHistory, withHistory } from './lego/history.js';
import { startGraph, type StartResult } from './start.js';
import { StartChoice } from './StartChoice.js';
import './builder.css';

export interface BuilderPageProps {
  /** 현재 라우트 (/builder/new) */
  route: string;
  /** 주입용 카탈로그 (없으면 API → 실패 시 기본 카탈로그) */
  catalog?: BuilderCatalog;
  /** 저장 API (없으면 토큰이 있을 때 HarnessApiClient.saveAgent) */
  saveAgent?: SaveAgentFn;
  /** 시험 실행 리플레이 간격 (테스트용) */
  dryRunStepMs?: number;
  /** 대화 탭 음성 입력 (기본: 설정 stt.provider + 감지 결과로 고른다) */
  loadStt?: () => Promise<SttHandle | undefined>;
}

const defaultLoadStt = () => resolveStt().then((r) => r.stt);

const builderReducer = withHistory(inspectorReducer);

/** 에이전트 만들기(컨셉 C): 시작 선택 → 블록 서랍 / 캔버스 / 인스펙터 */
export function BuilderPage({
  route,
  catalog: given,
  saveAgent,
  dryRunStepMs,
  loadStt = defaultLoadStt,
}: BuilderPageProps) {
  const catalog = useCatalog(given);
  const save = useSaveAgent(saveAgent);
  const [start, setStart] = useState<StartResult>();
  const [meta, setMeta] = useState<AgentMeta>({ name: 'new-agent', displayName: '새 에이전트' });
  const [overlay, setOverlay] = useState<Overlay>();
  const pipelineMeta: PipelineMeta = {
    name: meta.name,
    ...(meta.displayName ? { displayName: meta.displayName } : {}),
    ...(meta.entry ? { entry: meta.entry } : {}),
  };
  const [history, dispatch] = useReducer(builderReducer, undefined, () => initHistory(emptyGraph()));
  const graph = history.present;

  useEffect(() => {
    if (!start) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (mod && k === 'z') {
        e.preventDefault();
        dispatch({ type: 'undo' });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        dispatch({ type: 'removeSelected' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  return (
    <div className="hx-builder" data-route={route}>
      <header className="hx-builder__bar">
        <button type="button" className="hx-builder__back" onClick={() => navigate('/')}>
          ← 대화로
        </button>
        <h1 className="hx-builder__title">에이전트 만들기</h1>
        {start && <span className="hx-builder__origin">{start.origin}</span>}
        {start && (
          <span className="hx-builder__history">
            <button
              type="button"
              className="hx-icon-btn"
              aria-label="실행 취소"
              title="실행 취소 (Ctrl+Z)"
              disabled={!canUndo(history)}
              onClick={() => dispatch({ type: 'undo' })}
            >
              ↶
            </button>
            <button
              type="button"
              className="hx-icon-btn"
              aria-label="다시 실행"
              title="다시 실행 (Ctrl+Y)"
              disabled={!canRedo(history)}
              onClick={() => dispatch({ type: 'redo' })}
            >
              ↷
            </button>
          </span>
        )}
      </header>
      {start && <SaveBar graph={graph} meta={meta} onMeta={setMeta} {...(save ? { save } : {})} />}
      {start ? (
        <div className="hx-builder__cols">
          <BuilderSidebar
            catalog={catalog}
            initialMode={start.mode === 'chat' ? 'chat' : 'blocks'}
            chat={{ loadStt }}
          />
          <RunOverlayContext.Provider value={overlay}>
            <Canvas graph={graph} catalog={catalog} dispatch={dispatch} />
          </RunOverlayContext.Provider>
          <InspectorPanel
            graph={graph}
            catalog={catalog}
            meta={pipelineMeta}
            dispatch={dispatch}
            onMeta={(m) => setMeta((cur) => mergePipelineMeta(cur, m))}
            overlay={overlay}
            onOverlay={setOverlay}
            {...(meta.defaultEngine ? { defaultEngine: meta.defaultEngine } : {})}
            {...(dryRunStepMs !== undefined ? { dryRunStepMs } : {})}
          />
        </div>
      ) : (
        <StartChoice
          catalog={catalog}
          onChoose={(c) => {
            const r = startGraph(c, catalog);
            dispatch({ type: 'load', graph: r.graph });
            setMeta({ name: r.name, displayName: r.name, command: suggestCommand(r.name) });
            setStart(r);
          }}
        />
      )}
    </div>
  );
}

function useCatalog(given?: BuilderCatalog): BuilderCatalog {
  const [catalog, setCatalog] = useState<BuilderCatalog>(given ?? DEFAULT_CATALOG);
  useEffect(() => {
    if (given) return;
    const token = resolveToken();
    if (!token) return;
    let live = true;
    loadCatalog(new HarnessApiClient({ token }))
      .then((c) => live && setCatalog(c))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [given]);
  return catalog;
}

function useSaveAgent(given?: SaveAgentFn): SaveAgentFn | undefined {
  return useMemo(() => {
    if (given) return given;
    const token = resolveToken();
    if (!token) return undefined;
    const client = new HarnessApiClient({ token });
    return (name, body) => client.saveAgent(name, body);
  }, [given]);
}

export function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
  );
}
