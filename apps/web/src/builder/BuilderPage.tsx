import '@xyflow/react/dist/style.css';
import { useEffect, useReducer, useState } from 'react';
import { HarnessApiClient, resolveToken } from '../api/client.js';
import { navigate } from '../router.js';
import { Canvas } from './Canvas.js';
import { DEFAULT_CATALOG, loadCatalog, type BuilderCatalog } from './catalog.js';
import { Drawer } from './Drawer.js';
import { emptyGraph } from './graph.js';
import { Inspector } from './Inspector.js';
import { canRedo, canUndo, initHistory, withHistory } from './lego/history.js';
import { legoReducer } from './lego/model.js';
import { startGraph, type StartResult } from './start.js';
import { StartChoice } from './StartChoice.js';
import './builder.css';

export interface BuilderPageProps {
  /** 현재 라우트 (/builder/new) */
  route: string;
  /** 주입용 카탈로그 (없으면 API → 실패 시 기본 카탈로그) */
  catalog?: BuilderCatalog;
}

const builderReducer = withHistory(legoReducer);

/** 에이전트 만들기(컨셉 C): 시작 선택 → 블록 서랍 / 캔버스 / 인스펙터 */
export function BuilderPage({ route, catalog: given }: BuilderPageProps) {
  const catalog = useCatalog(given);
  const [start, setStart] = useState<StartResult>();
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
      {start ? (
        <div className="hx-builder__cols">
          <Drawer catalog={catalog} />
          <Canvas graph={graph} catalog={catalog} dispatch={dispatch} />
          <Inspector graph={graph} />
        </div>
      ) : (
        <StartChoice
          catalog={catalog}
          onChoose={(c) => {
            const r = startGraph(c, catalog);
            dispatch({ type: 'load', graph: r.graph });
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

export function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
  );
}
