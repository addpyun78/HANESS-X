import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/fonts.js';
import 'virtual:hx-tokens.css';
import './design/base.css';
import { applyTheme, loadThemePref } from './design/theme.js';
import { applyUiPrefs } from './design/ui-prefs.js';
import { Routes } from './Routes.js';
import { DevActionGuard } from './actions/DevActionGuard.js';

applyTheme(loadThemePref());
applyUiPrefs();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Routes />
    {/* T-101 0C.3 개발 모드: 등록되지 않은 data-action을 누르면 빨간 배너 */}
    {import.meta.env.DEV && <DevActionGuard />}
  </StrictMode>,
);
