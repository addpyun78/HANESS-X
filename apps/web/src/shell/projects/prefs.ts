import type { GroupMode, SortMode } from './model.js';

/** 0B.25/0B.26 사이드바 선택 기억 (묶기·정렬·접은 묶음). 브라우저 저장소가 막혀 있어도 동작한다 */
export interface SidebarPrefs {
  group: GroupMode;
  sort: SortMode;
  /** 접은 프로젝트 묶음 */
  collapsed: string[];
}

export const SIDEBAR_PREFS_KEY = 'hx-sidebar-prefs';
export const DEFAULT_PREFS: SidebarPrefs = { group: 'project', sort: 'recent', collapsed: [] };

const GROUPS: GroupMode[] = ['project', 'status', 'date', 'none'];
const SORTS: SortMode[] = ['recent', 'name', 'manual'];

export function loadPrefs(): SidebarPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(SIDEBAR_PREFS_KEY) ?? '{}') as Partial<SidebarPrefs>;
    return {
      group: GROUPS.includes(raw.group as GroupMode) ? (raw.group as GroupMode) : DEFAULT_PREFS.group,
      sort: SORTS.includes(raw.sort as SortMode) ? (raw.sort as SortMode) : DEFAULT_PREFS.sort,
      collapsed: Array.isArray(raw.collapsed) ? raw.collapsed.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: SidebarPrefs): void {
  try {
    localStorage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 저장소를 못 써도 이번 화면에서는 유지된다 */
  }
}
