import { createContext, useContext } from 'react';
import type { LegoAction } from './model.js';

/** 노드 안 스킬 칩을 끌 때 쓰는 dataTransfer 형식 */
export const CHIP_MIME = 'application/x-hx-skill-chip';

export interface ChipDrag {
  nodeId: string;
  skill: string;
}

export function readChip(dt: DataTransfer | null | undefined): ChipDrag | undefined {
  const raw = dt?.getData(CHIP_MIME);
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Partial<ChipDrag>;
    return typeof v.nodeId === 'string' && typeof v.skill === 'string'
      ? { nodeId: v.nodeId, skill: v.skill }
      : undefined;
  } catch {
    return undefined;
  }
}

export const hasType = (dt: DataTransfer | null | undefined, mime: string) =>
  Array.from(dt?.types ?? []).includes(mime);

/** 캔버스 안 노드·그룹 컴포넌트가 그래프를 바꿀 때 쓰는 dispatch */
export const LegoDispatch = createContext<(a: LegoAction) => void>(() => undefined);
export const useLegoDispatch = () => useContext(LegoDispatch);
