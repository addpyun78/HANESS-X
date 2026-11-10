/** 셸 레이아웃(열 너비·우측 패널 탭 순서) 저장/복원 — localStorage 'hx-layout' */

export const LAYOUT_KEY = 'hx-layout';

export const PANEL_TABS = [
  { id: 'checklist', label: '체크리스트' },
  { id: 'diff', label: 'Diff' },
  { id: 'terminal', label: '터미널' },
  { id: 'trajectory', label: '궤적' },
] as const;
export type PanelTabId = (typeof PANEL_TABS)[number]['id'];

export const SIDEBAR = { default: 240, min: 180, max: 400 } as const;
export const RIGHT = { default: 360, min: 280, max: 640 } as const;

export interface Layout {
  sidebarWidth: number;
  rightWidth: number;
  tabOrder: PanelTabId[];
}

export const DEFAULT_LAYOUT: Layout = {
  sidebarWidth: SIDEBAR.default,
  rightWidth: RIGHT.default,
  tabOrder: PANEL_TABS.map((t) => t.id),
};

export const clamp = (v: number, r: { min: number; max: number }) =>
  Math.round(Math.min(r.max, Math.max(r.min, v)));

/** 저장된 순서가 깨졌으면(누락·중복·모르는 id) 기본 순서에 맞춰 고친다 */
export function sanitizeOrder(order: unknown): PanelTabId[] {
  const all = DEFAULT_LAYOUT.tabOrder;
  if (!Array.isArray(order)) return [...all];
  const seen = order.filter(
    (x, i): x is PanelTabId => all.includes(x as PanelTabId) && order.indexOf(x) === i,
  );
  return [...seen, ...all.filter((x) => !seen.includes(x))];
}

export function loadLayout(storage: Storage | undefined = globalThis.localStorage): Layout {
  try {
    const raw = storage?.getItem(LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT, tabOrder: [...DEFAULT_LAYOUT.tabOrder] };
    const v = JSON.parse(raw) as Partial<Layout>;
    return {
      sidebarWidth: clamp(Number(v.sidebarWidth) || SIDEBAR.default, SIDEBAR),
      rightWidth: clamp(Number(v.rightWidth) || RIGHT.default, RIGHT),
      tabOrder: sanitizeOrder(v.tabOrder),
    };
  } catch {
    return { ...DEFAULT_LAYOUT, tabOrder: [...DEFAULT_LAYOUT.tabOrder] };
  }
}

export function saveLayout(l: Layout, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(LAYOUT_KEY, JSON.stringify(l));
  } catch {
    /* noop */
  }
}

/** from을 to 자리로 옮긴다 (to 앞에 끼움) */
export function moveTab(order: PanelTabId[], from: PanelTabId, to: PanelTabId): PanelTabId[] {
  if (from === to) return order;
  const rest = order.filter((x) => x !== from);
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  const at = rest.indexOf(to) + (fromIdx < toIdx ? 1 : 0);
  rest.splice(at, 0, from);
  return rest;
}
