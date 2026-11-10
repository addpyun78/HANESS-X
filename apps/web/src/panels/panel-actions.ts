import { createContext, useContext } from 'react';
import type { FileDiff } from './diff.js';

/** 채팅 카드 → 우측 패널 동작 (없으면 카드에 버튼을 그리지 않는다) */
export interface PanelActions {
  openDiff(file: FileDiff): void;
}

export const PanelActionsContext = createContext<PanelActions | undefined>(undefined);

export function usePanelActions(): PanelActions | undefined {
  return useContext(PanelActionsContext);
}
