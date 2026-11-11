import { applyTheme, THEME_KEY, type ThemePref } from './theme.js';

/**
 * T-101 6B.1 일반 설정 중 이 기기 화면에만 저장되는 것들 (레지스트리 ui.fontSize·ui.reduceMotion·ui.language).
 * 값은 브라우저 저장소에 두고, 문서 맨 위 요소(html)의 data-* 속성으로 바로 적용한다 (base.css가 읽음).
 */

export const FONT_SIZE_KEY = 'hx.ui.font-size';
export const REDUCE_MOTION_KEY = 'hx.ui.reduce-motion';
export const LANGUAGE_KEY = 'hx.ui.language';

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  [FONT_SIZE_KEY]: ['small', 'medium', 'large'],
  [REDUCE_MOTION_KEY]: ['system', 'on', 'off'],
  [LANGUAGE_KEY]: ['ko'],
};

function read(key: string): string | undefined {
  try {
    const v = globalThis.localStorage?.getItem(key) ?? undefined;
    return v !== undefined && ALLOWED[key]?.includes(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** 브라우저 저장 설정 하나를 화면에 바로 적용 (저장은 설정 폼이 한다) */
export function applyBrowserSetting(
  browserKey: string,
  value: unknown,
  root: HTMLElement = document.documentElement,
): void {
  const v = String(value);
  if (browserKey === THEME_KEY) applyTheme(v as ThemePref, root);
  else if (browserKey === FONT_SIZE_KEY) {
    if (v === 'medium' || !ALLOWED[FONT_SIZE_KEY]!.includes(v)) delete root.dataset.fontSize;
    else root.dataset.fontSize = v;
  } else if (browserKey === REDUCE_MOTION_KEY) {
    if (v === 'on' || v === 'off') root.dataset.reduceMotion = v;
    else delete root.dataset.reduceMotion;
  } else if (browserKey === LANGUAGE_KEY) root.lang = ALLOWED[LANGUAGE_KEY]!.includes(v) ? v : 'ko';
}

/** 앱 시작 때 저장된 값 적용 */
export function applyUiPrefs(root: HTMLElement = document.documentElement): void {
  applyBrowserSetting(FONT_SIZE_KEY, read(FONT_SIZE_KEY) ?? 'medium', root);
  applyBrowserSetting(REDUCE_MOTION_KEY, read(REDUCE_MOTION_KEY) ?? 'system', root);
  applyBrowserSetting(LANGUAGE_KEY, read(LANGUAGE_KEY) ?? 'ko', root);
}
