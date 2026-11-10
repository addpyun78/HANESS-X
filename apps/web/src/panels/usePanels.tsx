import type { HarnessEvent } from '@harness-x/protocol';
import { useMemo, useState, type ReactNode } from 'react';
import type { PanelTabId } from '../shell/layout-store.js';
import type { FileDiff } from './diff.js';
import { DiffPanel } from './DiffPanel.js';
import type { PanelActions } from './panel-actions.js';

export interface UsePanelsOptions {
  events: readonly HarnessEvent[];
  /** 터미널 패널(37.2)용 */
  client?: unknown;
  loginEngines?: { id: string; label: string }[];
}

/** 우측 패널(Diff·터미널·궤적) 상태 묶음 — App은 결과를 AppShell·PanelActionsContext에 넘기기만 한다 */
export function usePanels(_opts: UsePanelsOptions) {
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

  const content: Partial<Record<PanelTabId, ReactNode>> = {
    diff: <DiffPanel file={diff} />,
  };

  return { actions, active, setActive, content };
}
