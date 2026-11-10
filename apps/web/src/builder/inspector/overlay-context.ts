import { createContext, useContext } from 'react';
import type { Overlay } from './dryrun.js';

/** 46.4 시험 실행 오버레이 (캔버스 노드 카드가 읽는다) */
export const RunOverlayContext = createContext<Overlay | undefined>(undefined);

export const useRunOverlay = () => useContext(RunOverlayContext);
