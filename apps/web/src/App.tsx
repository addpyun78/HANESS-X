import type { HarnessEvent } from '@harness-x/protocol';
import { useEffect, useMemo, useState } from 'react';
import { HarnessApiClient, resolveToken, type ConnectionStatus } from './api/client.js';
import { ChatStream } from './chat/ChatStream.js';
import type { ViewMode } from './chat/blocks.js';
import { Composer } from './composer/Composer.js';
import { enginesFromPlugins } from './composer/engines.js';
import type { EngineOption } from './composer/types.js';
import { DEMO_SESSIONS, DEMO_WORKSPACE, demoEvents } from './demo.js';
import { PanelActionsContext } from './panels/panel-actions.js';
import { usePanels } from './panels/usePanels.js';
import { enginesApi } from './settings/Engines/api.js';
import { EnginesSettings } from './settings/Engines/EnginesSettings.js';
import { AppShell } from './shell/AppShell.js';
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

/** 메인 화면(컨셉 A): 상단 바 / 사이드바 · 채팅 + 입력창 · 우측 패널 */
export function App() {
  const demo = useMemo(demoParam, []);
  const [events, setEvents] = useState<HarnessEvent[]>(() => (demo ? demoEvents(demo) : []));
  const [engines, setEngines] = useState<EngineOption[]>(demo ? DEMO_ENGINES : []);
  const [conn, setConn] = useState<ConnectionStatus>('closed');
  const [mode, setMode] = useState<ViewMode>('normal');
  const sessions: SessionSummary[] = demo ? DEMO_SESSIONS : [];
  const workspace: Workspace | undefined = demo ? DEMO_WORKSPACE : undefined;
  const client = useMemo(() => {
    const token = demo ? undefined : resolveToken();
    return token ? new HarnessApiClient({ token }) : undefined;
  }, [demo]);
  const panels = usePanels({ events, client, loginEngines: engines });
  const [view, setView] = useState<'chat' | NavTarget>('chat');
  const available = useMemo(() => engines.filter((e) => e.available), [engines]);
  const quotas = useQuota(client, events, available);
  const engineSettings = useMemo(() => (client ? enginesApi(client) : undefined), [client]);

  useEffect(() => {
    if (!client) return;
    client
      .plugins()
      .then((r) => setEngines(enginesFromPlugins(r)))
      .catch(() => setEngines([]));
    const stream = client.events({ onEvent: (e) => setEvents((xs) => [...xs, e]), onStatus: setConn });
    return () => stream.close();
  }, [client]);

  const runState: RunState = demo
    ? 'running'
    : conn === 'reconnecting'
      ? 'error'
      : events.at(-1)?.type === 'turn_end' || events.length === 0
        ? 'idle'
        : 'running';

  return (
    <PanelActionsContext.Provider value={panels.actions}>
      <AppShell
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
            sessions={sessions}
            activeSessionId={sessions[0]?.id}
            onNavigate={(to) => setView(to === 'engines' ? 'engines' : 'chat')}
            onSelectSession={() => setView('chat')}
          />
        }
        main={
          view === 'engines' && engineSettings ? (
            <EnginesSettings api={engineSettings} />
          ) : (
            <>
              <ChatStream events={events} mode={mode} onModeChange={setMode} />
              <Composer
                engines={engines}
                onSend={() => {
                  /* 턴 전송 API는 이후 티켓에서 연결 */
                }}
                verdict={demo ? { itemId: '2.1', rung: 2, passed: true } : undefined}
              />
            </>
          )
        }
      />
    </PanelActionsContext.Provider>
  );
}
