import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'virtual:hx-tokens.css';
import './design/base.css';
import { App } from './App.js';
import { applyTheme, loadThemePref } from './design/theme.js';

applyTheme(loadThemePref());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
