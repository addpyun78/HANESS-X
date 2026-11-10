/** 테마 수동 토글: system(OS 설정 따름) → light → dark → system … */

export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_KEY = 'hx-theme';
export const THEME_ORDER: ThemePref[] = ['system', 'light', 'dark'];
export const THEME_LABEL: Record<ThemePref, string> = {
  system: '시스템 테마',
  light: '라이트 테마',
  dark: '다크 테마',
};

export function loadThemePref(): ThemePref {
  try {
    const v = globalThis.localStorage?.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* 저장소 사용 불가 */
  }
  return 'system';
}

export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    globalThis.localStorage?.setItem(THEME_KEY, pref);
  } catch {
    /* noop */
  }
}

export function nextTheme(pref: ThemePref): ThemePref {
  return THEME_ORDER[(THEME_ORDER.indexOf(pref) + 1) % THEME_ORDER.length]!;
}
