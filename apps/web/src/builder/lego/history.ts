/**
 * 실행 취소/다시 실행 (Ctrl+Z / Ctrl+Y). 최대 50단계.
 * - 상태를 바꾸는 동작만 기록한다(같은 상태를 돌려주면 기록 안 함).
 * - 선택·이동은 기록하지 않는다. 끌기 시작할 때 checkpoint를 한 번 남겨 끌기 전체가 한 단계가 된다.
 * - load는 기록을 비운다.
 */

export const HISTORY_LIMIT = 50;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export type HistoryAction = { type: 'undo' } | { type: 'redo' } | { type: 'checkpoint' };

const UNRECORDED = new Set(['select', 'moveNode', 'moveGroup']);

export const initHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

const push = <T>(past: T[], x: T) => [...past, x].slice(-HISTORY_LIMIT);

export function withHistory<T, A extends { type: string }>(reducer: (s: T, a: A) => T) {
  return (h: History<T>, a: A | HistoryAction): History<T> => {
    switch (a.type) {
      case 'undo': {
        const prev = h.past.at(-1);
        if (prev === undefined) return h;
        return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
      }
      case 'redo': {
        const [next, ...rest] = h.future;
        if (next === undefined) return h;
        return { past: push(h.past, h.present), present: next, future: rest };
      }
      case 'checkpoint':
        return { past: push(h.past, h.present), present: h.present, future: [] };
    }
    const action = a as A;
    const next = reducer(h.present, action);
    if (action.type === 'load') return initHistory(next);
    if (next === h.present) return h;
    if (UNRECORDED.has(action.type)) return { ...h, present: next };
    return { past: push(h.past, h.present), present: next, future: [] };
  };
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;
