import type { AgentSummary, HarnessEvent } from '@harness-x/protocol';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  HarnessApiClient,
  resolveToken,
  type ConnectionStatus,
  type WorkspaceInfo,
} from './api/client.js';
import { isTauri, pickFolderDesktop, waitForDesktopServer } from './api/desktop.js';
import { ChatStream } from './chat/ChatStream.js';
import type { ViewMode } from './chat/blocks.js';
import { Composer } from './composer/Composer.js';
import { enginesFromPlugins } from './composer/engines.js';
import type { RecentProject } from './composer/PlusMenu.js';
import { SubagentConfirm, subagentTarget } from './composer/SubagentConfirm.js';
import type { EngineOption, SendPayload } from './composer/types.js';
import { DEMO_SESSIONS, DEMO_WORKSPACE, demoEvents } from './demo.js';
import { navigate } from './router.js';
import { PanelActionsContext } from './panels/panel-actions.js';
import { usePanels } from './panels/usePanels.js';
import { approvalsApi } from './panels/Approvals/api.js';
import { ApprovalsArea } from './panels/Approvals/ApprovalsArea.js';
import { Toasts } from './panels/Approvals/Toasts.js';
import { ApprovalFocusContext, useApprovals, type ApprovalFocus } from './panels/Approvals/useApprovals.js';
import { noticesApi, useNotices } from './panels/Approvals/useNotices.js';
import { enginesApi } from './settings/Engines/api.js';
import { EnginesSettings } from './settings/Engines/EnginesSettings.js';
import { AppShell } from './shell/AppShell.js';
import { useIsMobile } from './shell/mobile.js';
import { agentSessionsFromEvents, fromDispatchSession } from './shell/agent-sessions.js';
import { ForgeAnswerContext, type ForgeActions } from './forge/ForgeCards.js';
import { SessionNav } from './shell/SessionNav.js';
import type { NavTarget, RunState, SessionSummary, Workspace } from './shell/types.js';
import { useQuota } from './shell/useQuota.js';

const DEMO_ENGINES: EngineOption[] = [
  { id: 'claude-code', label: 'Claude Code', available: true },
  { id: 'codex', label: 'Codex', available: true },
  { id: 'antigravity', label: 'Antigravity', available: false },
];

function demoParam(): number | undefined {
  const v = new URLSearchParams(location.search).get('demo');
  return v === null ? undefined : Number(v) || 1;
}

const toWorkspace = (w: WorkspaceInfo): Workspace => ({
  name: w.name,
  path: w.path,
  ...(w.branch ? { branch: w.branch } : {}),
  hasAgentsMd: w.hasAgentsMd,
  hasClaudeMd: w.hasClaudeMd,
});

/** 메인 화면(컨셉 A): 상단 바 / 사이드바 · 채팅 + 입력창 · 우측 패널 */
export function App() {
  const demo = useMemo(demoParam, []);
  const [events, setEvents] = useState<HarnessEvent[]>(() => (demo ? demoEvents(demo) : []));
  const [engines, setEngines] = useState<EngineOption[]>(demo ? DEMO_ENGINES : []);
  const [conn, setConn] = useState<ConnectionStatus>('closed');
  const [mode, setMode] = useState<ViewMode>('normal');
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | undefined>(demo ? DEMO_WORKSPACE : undefined);
  // 48.1/48.3 / 디스패치 세션: POST 응답(즉시) + 이벤트(진행) → 사이드바
  const [dispatched, setDispatched] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [confirm, setConfirm] = useState<{ payload: SendPayload; running: SessionSummary }>();
  const [sendError, setSendError] = useState<string>();
  const sessions: SessionSummary[] = useMemo(() => {
    if (demo) return DEMO_SESSIONS;
    const live = agentSessionsFromEvents(events, workspace?.name ?? '프로젝트');
    const ids = new Set(live.map((x) => x.id));
    return [...live, ...dispatched.filter((x) => !ids.has(x.id))];
  }, [demo, events, dispatched, workspace?.name]);
  const [recent, setRecent] = useState<RecentProject[]>(demo ? [DEMO_WORKSPACE] : []);
  const [wsError, setWsError] = useState<string>();
  const [client, setClient] = useState<HarnessApiClient>();
  const mobile = useIsMobile();
  const desktop = useMemo(() => isTauri(), []);
  const panels = usePanels({ events, client, loginEngines: engines });
  const [view, setView] = useState<'chat' | NavTarget>('chat');
  const available = useMemo(() => engines.filter((e) => e.available), [engines]);
  const quotas = useQuota(client, events, available);
  const engineSettings = useMemo(() => (client ? enginesApi(client) : undefined), [client]);
  // T-100 H.10~H.16 쉬운 말 승인 카드: 패널 맨 위 · 토스트 · 사이드바 배지 · 탭 제목 · 채팅 축소 카드
  const apApi = useMemo(() => (client ? approvalsApi(client) : undefined), [client]);
  const approvals = useApprovals({ events, ...(apApi ? { api: apApi } : {}) });
  const { setFocusId } = approvals;
  // T-100 J.6 한 번만 보여 주는 안내 (GET /api/notices + notice 이벤트) → 토스트
  const ntApi = useMemo(() => (client ? noticesApi(client) : undefined), [client]);
  const notices = useNotices({ events, ...(ntApi ? { api: ntApi } : {}) });
  const toasts = useMemo(() => [...approvals.toasts, ...notices.toasts], [approvals.toasts, notices.toasts]);
  const { dismissToast } = approvals;
  const { dismiss: dismissNotice } = notices;
  const onDismissToast = useCallback(
    (id: string) => (id.startsWith('n-') ? dismissNotice(id) : dismissToast(id)),
    [dismissNotice, dismissToast],
  );
  const approvalFocus = useMemo<ApprovalFocus>(() => ({ focus: (id) => setFocusId(id) }), [setFocusId]);
  const navSessions = useMemo(
    () =>
      sessions.map((x) =>
        approvals.bySession[x.id] ? { ...x, needsApproval: approvals.bySession[x.id] } : x,
      ),
    [sessions, approvals.bySession],
  );

  useEffect(() => {
    if (demo) return;
    let stopped = false;
    let stream: { close(): void } | undefined;
    const start = (client: HarnessApiClient) => {
      if (stopped) return;
      setClient(client);
      client
        .workspaces()
        .then((r) => {
          setRecent(r.recent);
          if (r.current) setWorkspace(toWorkspace(r.current));
        })
        .catch(() => {});
      client
        .plugins()
        .then((r) => setEngines(enginesFromPlugins(r)))
        .catch(() => setEngines([]));
      client
        .agents()
        .then((r) => setAgents(r.agents))
        .catch(() => setAgents([]));
      stream = client.events({ onEvent: (e) => setEvents((xs) => [...xs, e]), onStatus: setConn });
    };
    if (desktop) {
      // 63.2 데스크톱: 앱이 띄운 사이드카 서버의 주소·토큰
      waitForDesktopServer()
        .then(({ url, token }) => start(new HarnessApiClient({ baseUrl: url, token })))
        .catch((err: unknown) => setWsError(err instanceof Error ? err.message : String(err)));
    } else {
      const token = resolveToken();
      if (token) start(new HarnessApiClient({ token }));
    }
    return () => {
      stopped = true;
      stream?.close();
    };
  }, [demo, desktop]);

  const runState: RunState = demo
    ? 'running'
    : conn === 'reconnecting'
      ? 'error'
      : events.at(-1)?.type === 'turn_end' || events.length === 0
        ? 'idle'
        : 'running';

  // 35.1~35.4 경로 검증·등록 → 상단 바 갱신 (다음 세션 cwd는 서버의 현재 워크스페이스)
  const openWorkspace = async (path: string) => {
    if (!client) return;
    try {
      const r = await client.openWorkspace(path);
      setWorkspace(toWorkspace(r.workspace));
      setRecent(r.recent);
      setWsError(undefined);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string } | undefined) : undefined;
      setWsError(body?.message ?? (err instanceof Error ? err.message : String(err)));
    }
  };

  // 34.1/34.6 + → "프로젝트 폴더 열기…" → 서버가 네이티브 대화상자. 취소(·409)면 아무 변화 없음
  const openFolder = async () => {
    if (!client) return;
    let r;
    try {
      // 63.3 데스크톱은 Tauri 대화상자(open({ directory: true })), 브라우저는 서버의 네이티브 대화상자
      r = desktop ? await pickFolderDesktop(workspace?.path) : await client.pickFolder(workspace?.path);
    } catch {
      return;
    }
    if (!r.cancelled) await openWorkspace(r.path);
  };

  // 48.1 칩 + 지시문 → POST /api/sessions (새 세션). 48.4 실행 중이면 서브에이전트로 추가할지 먼저 묻는다
  const startSession = async (p: SendPayload) => {
    if (!client || !p.agent) return;
    try {
      const d = await client.createSession({ agent: p.agent, prompt: p.text });
      setDispatched((xs) => [fromDispatchSession(d, workspace?.name ?? '프로젝트'), ...xs]);
      setActiveId(d.sessionId);
      setSendError(undefined);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string } | undefined) : undefined;
      setSendError(body?.message ?? (err instanceof Error ? err.message : String(err)));
    }
  };
  const addSubagent = async (running: SessionSummary, agent: string) => {
    if (!client) return;
    try {
      await client.addSubagent(running.id, agent);
      setSendError(undefined);
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { message?: string } | undefined) : undefined;
      setSendError(body?.message ?? (err instanceof Error ? err.message : String(err)));
    }
  };
  const onSend = (p: SendPayload) => {
    if (!p.agent) return; // 일반 턴 전송 API는 이후 티켓에서 연결
    const running = subagentTarget(p, sessions, activeId);
    if (running) setConfirm({ payload: p, running });
    else void startSession(p);
  };

  const togglePin = async (p: RecentProject) => {
    if (!client) return;
    try {
      setRecent((await client.pinWorkspace(p.path, !p.pinned)).recent);
    } catch {
      /* noop */
    }
  };

  // Forge 카드 버튼 → 서버로 답 전송 (서버 연결 전·데모에서는 무시)
  const forgeActions = useMemo<ForgeActions>(
    () => ({
      onAnswer: (approvalId, answer) => {
        void client?.forgeAnswer(approvalId, answer).catch(() => {});
      },
    }),
    [client],
  );

  return (
    <ForgeAnswerContext.Provider value={forgeActions}>
      <ApprovalFocusContext.Provider value={approvalFocus}>
        <PanelActionsContext.Provider value={panels.actions}>
          <AppShell
            panelTop={
              <ApprovalsArea
                cards={approvals.pending}
                onChoose={(id, choice, remember) => void approvals.choose(id, choice, remember)}
                {...(approvals.busy ? { busy: approvals.busy } : {})}
                errors={approvals.errors}
                {...(approvals.last ? { last: approvals.last } : {})}
                onUndo={() => void approvals.undo()}
                {...(approvals.focusId ? { focusId: approvals.focusId } : {})}
                onFocused={() => setFocusId(undefined)}
              />
            }
            panelContent={panels.content}
            panelActive={panels.active}
            onPanelActiveChange={panels.setActive}
            topBar={{
              workspace,
              runState,
              quotas:
                quotas ??
                available.map((e) => ({ engineId: e.id, label: e.label, ...(demo ? { ratio: 0.42 } : {}) })),
            }}
            sidebar={
              <SessionNav
                sessions={navSessions}
                activeSessionId={activeId ?? sessions[0]?.id}
                onNavigate={(to) => {
                  if (to === 'agent-builder') navigate('/builder/new');
                  else setView(to === 'engines' ? 'engines' : 'chat');
                }}
                onSelectSession={(id) => {
                  setActiveId(id);
                  setView('chat');
                }}
              />
            }
            main={
              view === 'engines' && engineSettings ? (
                <EnginesSettings api={engineSettings} />
              ) : (
                <>
                  <ChatStream events={events} mode={mode} onModeChange={setMode} />
                  {wsError && (
                    <div className="hx-ws-error" role="alert">
                      {wsError}
                    </div>
                  )}
                  {sendError && (
                    <div className="hx-ws-error" role="alert">
                      {sendError}
                    </div>
                  )}
                  {confirm && (
                    <SubagentConfirm
                      agent={confirm.payload.agent!}
                      running={confirm.running}
                      onAddSubagent={() => {
                        setConfirm(undefined);
                        void addSubagent(confirm.running, confirm.payload.agent!);
                      }}
                      onNewSession={() => {
                        setConfirm(undefined);
                        void startSession(confirm.payload);
                      }}
                      onCancel={() => setConfirm(undefined)}
                    />
                  )}
                  <Composer
                    engines={engines}
                    plusMenu={{
                      mobile,
                      recent,
                      onOpenFolder: () => void openFolder(),
                      onPickRecent: (p) => void openWorkspace(p.path),
                      onTogglePin: (p) => void togglePin(p),
                    }}
                    agents={agents}
                    onSend={onSend}
                    verdict={demo ? { itemId: '2.1', rung: 2, passed: true } : undefined}
                  />
                </>
              )
            }
          />
          <Toasts toasts={toasts} onOpen={setFocusId} onDismiss={onDismissToast} />
        </PanelActionsContext.Provider>
      </ApprovalFocusContext.Provider>
    </ForgeAnswerContext.Provider>
  );
}
