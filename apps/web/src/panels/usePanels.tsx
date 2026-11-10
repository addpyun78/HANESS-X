import type { HarnessEvent } from '@harness-x/protocol';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { HarnessApiClient } from '../api/client.js';
import type { PanelTabId } from '../shell/layout-store.js';
import { checklistApi } from './Checklist/api.js';
import { ChecklistPanel } from './Checklist/ChecklistPanel.js';
import type { FileDiff } from './diff.js';
import { DiffPanel } from './DiffPanel.js';
import type { PanelActions } from './panel-actions.js';
import { TerminalPanel, type CreateTerminalView } from './TerminalPanel.js';
import type { TerminalSocket } from './terminal-session.js';
import { TrajectoryPanel } from './TrajectoryPanel.js';

export interface UsePanelsOptions {
  events: readonly HarnessEvent[];
  /** 없으면 터미널 탭은 연결 안내만 */
  client?: Pick<HarnessApiClient, 'terminalUrl' | 'openSocket'> & Partial<Pick<HarnessApiClient, 'request'>>;
  loginEngines?: { id: string; label: string }[];
  createTerminalView?: CreateTerminalView;
}

/** 우측 패널(체크리스트·Diff·터미널·궤적) 상태 묶음 — App은 결과를 AppShell·PanelActionsContext에 넘기기만 한다 */
export function usePanels({ events, client, loginEngines, createTerminalView }: UsePanelsOptions) {
  const [active, setActive] = useState<PanelTabId | undefined>();
  const [diff, setDiff] = useState<FileDiff>();

  const actions = useMemo<PanelActions>(
    () => ({
      openDiff: (f) => {
        setDiff(f);
        setActive('diff');
      },
    }),
    [],
  );

  const connect = useCallback(
    (size: { cols: number; rows: number }) =>
      client!.openSocket(client!.terminalUrl(size)) as unknown as TerminalSocket,
    [client],
  );

  const ckApi = useMemo(
    () => (client?.request ? checklistApi({ request: client.request.bind(client) }) : undefined),
    [client],
  );

  const content: Partial<Record<PanelTabId, ReactNode>> = {
    checklist: <ChecklistPanel events={events} {...(ckApi ? { api: ckApi } : {})} />,
    diff: <DiffPanel file={diff} />,
    terminal: client ? (
      <TerminalPanel connect={connect} loginEngines={loginEngines} createView={createTerminalView} />
    ) : (
      <p className="hx-panel-empty">하네스 서버에 연결하면 터미널을 쓸 수 있습니다</p>
    ),
    trajectory: <TrajectoryPanel events={events} />,
  };

  return { actions, active, setActive, content };
}
