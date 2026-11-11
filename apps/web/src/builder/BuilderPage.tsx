import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
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
import type { DraftGap } from '@harness-x/protocol';
import { httpDesignerApi, type DesignerApi, type SaveDraftResponse } from './draft/api.js';
import { DraftDecorContext } from './draft/decor.js';
import { Checklist, DraftBanner, DraftList, GapLayer, ResumePrompt } from './draft/DraftCards.js';
import { SaveDialog } from './draft/SaveDialog.js';
import {
  openToolPickerForGap,
  openUrlInstall,
  toolPickerApi,
  type ToolPickerApi,
} from '../panels/ToolPicker/api.js';
import { ToolPickerCard } from '../panels/ToolPicker/ToolPickerCard.js';
import type { ToolPickerData } from '../panels/ToolPicker/model.js';
import { animationEnabled, useDraftSession } from './draft/useDraftSession.js';
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
  /** T-100 P4 대화로 만들기 서버 API (없으면 토큰이 있을 때 HTTP) */
  designerApi?: DesignerApi;
  /** P4-D.2 조립 애니메이션 (기본: 설정 hx.builder.animation ≠ off) */
  animate?: boolean;
  /** P4-C.10 빈 칸 [도구 찾기] — Part 3(D.3) 도구 고르기 카드가 연결한다 */
  onFindTool?: (gap: DraftGap) => void;
  /** P4-C.11 빈 칸 [Forge로 만들기] (기본: Forge 입력창에 채우고 이동) */
  onForge?: (gap: DraftGap) => void;
  /** 초안 자동 보관 지연 (테스트용) */
  autosaveMs?: number;
  /** P3-D.3 [도구 찾기]가 쓰는 도구 찾기 API (없으면 토큰이 있을 때 HTTP) */
  toolPicker?: Pick<ToolPickerApi, 'find'>;
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
  designerApi,
  animate,
  onFindTool,
  onForge,
  autosaveMs,
  toolPicker,
}: BuilderPageProps) {
  const catalog = useCatalog(given);
  const save = useSaveAgent(saveAgent);
  const api = useDesignerApi(designerApi);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SaveDraftResponse>();
  // P4-C.10 ↔ P3-D.3 빈 칸 [도구 찾기] → 도구 고르기 카드
  const finder = useToolPickerApi(toolPicker);
  const [pickerCards, setPickerCards] = useState<ToolPickerData[]>([]);
  const [pickerNote, setPickerNote] = useState<string>();
  const findTool = useCallback(
    (gap: DraftGap) => {
      if (!finder) return;
      setPickerNote(undefined);
      void openToolPickerForGap(
        { nodeId: gap.nodeId ?? gap.id, capability: gap.need },
        {
          api: finder,
          show: (card) => setPickerCards((cs) => [...cs, card]),
          onHave: (r) => setPickerNote(r.message),
        },
      ).catch(() => setPickerNote('도구를 찾지 못했어요. 잠시 뒤 다시 눌러 주세요.'));
    },
    [finder],
  );
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
  const onDraftMeta = useCallback(
    (m: { name: string; displayName: string; command: string }) => setMeta((cur) => ({ ...cur, ...m })),
    [],
  );
  const draft = useDraftSession({
    api,
    graph,
    dispatch: dispatch as (a: { type: string } & Record<string, unknown>) => void,
    catalog,
    onMeta: onDraftMeta,
    animate: animate ?? animationEnabled(),
    onFindTool: onFindTool ?? findTool,
    ...(onForge ? { onForge } : {}),
    ...(autosaveMs !== undefined ? { autosaveMs } : {}),
  });
  const editDispatch = draft.session ? draft.track : dispatch;

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
      {start && draft.session && (
        <>
          <DraftBanner
            version={draft.session.version}
            versions={draft.session.record?.versions ?? []}
            onRevert={(v) => void draft.revert(v)}
          />
          <div className="hx-savebar" aria-label="초안 저장">
            <button
              type="button"
              className="hx-insp-btn"
              disabled={!api || graph.nodes.length === 0}
              onClick={() => setSaving(true)}
            >
              저장
            </button>
            {saved && (
              <span role="status">
                저장됐어요 · {saved.command}로 부를 수 있어요
                {saved.status === 'incomplete' ? ' (빈 칸을 채워야 실행돼요)' : ''}
              </span>
            )}
          </div>
          {saving && draft.current && api && (
            <SaveDialog
              draftId={draft.session.id}
              draft={draft.current}
              api={api}
              onClose={() => setSaving(false)}
              onFillGaps={() => setSaving(false)}
              onSaved={(r) => {
                setSaving(false);
                setSaved(r);
                draft.markSaved();
              }}
            />
          )}
        </>
      )}
      {start && !draft.session && (
        <SaveBar graph={graph} meta={meta} onMeta={setMeta} {...(save ? { save } : {})} />
      )}
      {start ? (
        <div className="hx-builder__cols">
          <BuilderSidebar
            catalog={catalog}
            initialMode={start.mode === 'chat' ? 'chat' : 'blocks'}
            chat={{ loadStt, ...draft.chat }}
          />
          <RunOverlayContext.Provider value={overlay}>
            <DraftDecorContext.Provider value={draft.decor}>
              <Canvas graph={draft.canvasGraph} catalog={catalog} dispatch={editDispatch}>
                <GapLayer gaps={draft.gaps} {...draft.gapActions} />
                {(pickerCards.length > 0 || pickerNote) && (
                  <div className="hx-gap-picker" aria-label="도구 고르기">
                    {pickerNote && <p role="status">{pickerNote}</p>}
                    {pickerCards.map((c) => (
                      <ToolPickerCard
                        key={c.id}
                        data={c}
                        onOpenUrlInstall={() => openUrlInstall()}
                        onContinueWithout={() => setPickerCards((cs) => cs.filter((x) => x.id !== c.id))}
                      />
                    ))}
                  </div>
                )}
              </Canvas>
            </DraftDecorContext.Provider>
          </RunOverlayContext.Provider>
          <InspectorPanel
            graph={graph}
            catalog={catalog}
            meta={pipelineMeta}
            dispatch={editDispatch}
            {...(draft.session
              ? { reasons: draft.reasons, footer: <Checklist rows={draft.checklist} /> }
              : {})}
            onMeta={(m) => setMeta((cur) => mergePipelineMeta(cur, m))}
            overlay={overlay}
            onOverlay={setOverlay}
            {...(meta.defaultEngine ? { defaultEngine: meta.defaultEngine } : {})}
            {...(dryRunStepMs !== undefined ? { dryRunStepMs } : {})}
          />
        </div>
      ) : (
        <>
          {draft.resume && (
            <ResumePrompt
              item={draft.resume}
              onResume={() => {
                const r = startGraph({ kind: 'chat' }, catalog);
                setStart(r);
                void draft.resumeDraft(draft.resume!.id);
              }}
              onDismiss={draft.dismissResume}
            />
          )}
          {draft.drafts.length > 0 && (
            <DraftList
              items={draft.drafts}
              onResume={(id) => {
                setStart(startGraph({ kind: 'chat' }, catalog));
                void draft.resumeDraft(id);
              }}
              onDelete={(id) => void draft.deleteDraft(id)}
            />
          )}
          <StartChoice
            catalog={catalog}
            onChoose={(c) => {
              const r = startGraph(c, catalog);
              dispatch({ type: 'load', graph: r.graph });
              setMeta({ name: r.name, displayName: r.name, command: suggestCommand(r.name) });
              setStart(r);
            }}
          />
        </>
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

function useDesignerApi(given?: DesignerApi): DesignerApi | undefined {
  return useMemo(() => {
    if (given) return given;
    const token = resolveToken();
    return token ? httpDesignerApi(new HarnessApiClient({ token })) : undefined;
  }, [given]);
}

function useToolPickerApi(given?: Pick<ToolPickerApi, 'find'>): Pick<ToolPickerApi, 'find'> | undefined {
  return useMemo(() => {
    if (given) return given;
    const token = resolveToken();
    return token ? toolPickerApi(new HarnessApiClient({ token })) : undefined;
  }, [given]);
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
