import { createContext, useContext } from 'react';

/**
 * 캔버스 초안 표시 (LegoNode가 읽는다)
 * - draft: 초안 상태면 노드 테두리 점선 (P4-D.1)
 * - changed / chips: AI 패치 미리보기로 바뀐 노드·칩 노란색 (P4-E.4)
 * - hidden: 조립 애니메이션에서 아직 안 나타난 노드 (P4-D.2)
 */
export interface DraftDecor {
  draft: boolean;
  changed: ReadonlySet<string>;
  chips: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
}

const EMPTY = new Set<string>();
export const NO_DECOR: DraftDecor = { draft: false, changed: EMPTY, chips: EMPTY, hidden: EMPTY };

export const DraftDecorContext = createContext<DraftDecor>(NO_DECOR);
export const useDraftDecor = () => useContext(DraftDecorContext);
