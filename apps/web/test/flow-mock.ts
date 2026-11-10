import { BLOCK_MIME } from '../src/builder/catalog.js';

/** jsdom에서 React Flow가 쓰는 브라우저 API 흉내 (ResizeObserver, DOMMatrixReadOnly) */
export function mockReactFlowDom() {
  const g = globalThis as Record<string, unknown>;
  if (!g.ResizeObserver)
    g.ResizeObserver = class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(target: Element) {
        this.cb([{ target } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    };
  if (!g.DOMMatrixReadOnly)
    g.DOMMatrixReadOnly = class {
      m22: number;
      constructor(t?: string) {
        const scale = t?.match(/scale\(([1-9.])\)/)?.[1];
        this.m22 = scale !== undefined ? +scale : 1;
      }
    };
}

/** 서랍 블록 dataTransfer (fireEvent.dragOver/drop 용) */
export function blockTransfer(kind: string, id: string, extra: Record<string, string> = {}) {
  const data: Record<string, string> = {
    [BLOCK_MIME]: JSON.stringify({ kind, id }),
    [`${BLOCK_MIME}-${kind}`]: id,
    ...extra,
  };
  return {
    types: Object.keys(data),
    getData: (k: string) => data[k] ?? '',
    setData: (k: string, v: string) => {
      data[k] = v;
    },
    dropEffect: 'none',
    effectAllowed: 'all',
  };
}
