import { useEffect, useState } from 'react';
import { applyTheme, loadThemePref, nextTheme, THEME_LABEL, type ThemePref } from './theme.js';
import { act } from '../actions/registry.js';

const ICON: Record<ThemePref, string> = { system: '◐', light: '☀', dark: '☾' };

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(loadThemePref);
  useEffect(() => applyTheme(pref), [pref]);
  return (
    <button
      {...act('topbar.theme')}
      type="button"
      className="hx-icon-btn"
      aria-label={`테마 바꾸기 (현재: ${THEME_LABEL[pref]})`}
      title={THEME_LABEL[pref]}
      data-theme-pref={pref}
      onClick={() => setPref(nextTheme(pref))}
    >
      {ICON[pref]}
    </button>
  );
}
