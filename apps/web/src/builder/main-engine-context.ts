import { createContext, useContext } from 'react';

/** T-101 5D.3 지금 메인 AI 엔진 — 노드 엔진 칩이 `메인(claude-code)`으로 보여 준다 */
export const MainEngineContext = createContext<string | undefined>(undefined);

export const useMainEngine = (): string | undefined => useContext(MainEngineContext);
