import type { GroupMode, SortMode } from './model.js';

/** 0B.25/0B.26 사이드바 선택 기억 (묶기·정렬·접은 묶음). 브라우저 저장소가 막혀 있어도 동작한다 */
export interface SidebarPrefs {
  group: GroupMode;
  sort: SortMode;
  /** 접은 프로젝트 묶음 */
  collapsed: string[];
}

/** 묶기·정렬은 설정 화면(프로젝트 섹션)에도 나오는 설정이라 값만 따로 저장, 접은 묶음은 화면 상태 */
export const SIDEBAR_GROUP_KEY = 'hx-sidebar-group';
export const SIDEBAR_SORT_KEY = 'hx-sidebar-sort';
export const SIDEBAR_COLLAPSED_KEY = 'hx-sidebar-collapsed';
export const DEFAULT_PREFS: SidebarPrefs = { group: 'project', sort: 'recent', collapsed: [] };

const GROUPS: GroupMode[] = ['project', 'status', 'date', 'none'];
const SORTS: SortMode[] = ['recent', 'name', 'manual'];

export function loadPrefs(): SidebarPrefs {
  try {
    const group = localStorage.getItem(SIDEBAR_GROUP_KEY) as GroupMode | null;
    const sort = localStorage.getItem(SIDEBAR_SORT_KEY) as SortMode | null;
    const collapsed = JSON.parse(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) ?? '[]') as unknown;
    return {
      group: group && GROUPS.includes(group) ? group : DEFAULT_PREFS.group,
      sort: sort && SORTS.includes(sort) ? sort : DEFAULT_PREFS.sort,
      collapsed: Array.isArray(collapsed) ? collapsed.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: SidebarPrefs): void {
  try {
    localStorage.setItem(SIDEBAR_GROUP_KEY, p.group);
    localStorage.setItem(SIDEBAR_SORT_KEY, p.sort);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify(p.collapsed));
  } catch {
    /* 저장소를 못 써도 이번 화면에서는 유지된다 */
  }
}
