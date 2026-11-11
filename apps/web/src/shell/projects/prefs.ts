import type { GroupMode, SortMode } from './model.js';

/**
 * 0B.25/0B.26 사이드바 선택 기억 (묶기·정렬·접은 묶음). 브라우저 저장소가 막혀 있어도 동작한다.
 * T-101 6B.10: 묶기·정렬은 설정 화면(프로젝트 탭 project.sidebarGroup·project.sidebarSort)과 같은 저장 이름을 쓴다.
 * 접은 묶음은 화면 상태라 예전 이름(hx-sidebar-prefs)에 그대로 둔다.
 */
export interface SidebarPrefs {
  group: GroupMode;
  sort: SortMode;
  /** 접은 프로젝트 묶음 */
  collapsed: string[];
}

export const SIDEBAR_PREFS_KEY = 'hx-sidebar-prefs';
export const SIDEBAR_GROUP_KEY = 'hx.sidebar.group';
export const SIDEBAR_SORT_KEY = 'hx.sidebar.sort';
export const DEFAULT_PREFS: SidebarPrefs = { group: 'project', sort: 'recent', collapsed: [] };

const GROUPS: GroupMode[] = ['project', 'status', 'date', 'none'];
const SORTS: SortMode[] = ['recent', 'name', 'manual'];

export function loadPrefs(): SidebarPrefs {
  try {
    // 예전 저장 모양({group, sort, collapsed})도 읽는다
    const raw = JSON.parse(localStorage.getItem(SIDEBAR_PREFS_KEY) ?? '{}') as Partial<SidebarPrefs>;
    const group = localStorage.getItem(SIDEBAR_GROUP_KEY) ?? raw.group;
    const sort = localStorage.getItem(SIDEBAR_SORT_KEY) ?? raw.sort;
    return {
      group: GROUPS.includes(group as GroupMode) ? (group as GroupMode) : DEFAULT_PREFS.group,
      sort: SORTS.includes(sort as SortMode) ? (sort as SortMode) : DEFAULT_PREFS.sort,
      collapsed: Array.isArray(raw.collapsed) ? raw.collapsed.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: SidebarPrefs): void {
  try {
    localStorage.setItem(SIDEBAR_GROUP_KEY, p.group);
    localStorage.setItem(SIDEBAR_SORT_KEY, p.sort);
    localStorage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify({ collapsed: p.collapsed }));
  } catch {
    /* 저장소를 못 써도 이번 화면에서는 유지된다 */
  }
}
