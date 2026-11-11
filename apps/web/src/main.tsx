import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/fonts.js';
import 'virtual:hx-tokens.css';
import './design/base.css';
import { applyTheme, loadThemePref } from './design/theme.js';
import { applyUiPrefs } from './design/ui-prefs.js';
import { Routes } from './Routes.js';

applyTheme(loadThemePref());
applyUiPrefs();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Routes />
  </StrictMode>,
);
