import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { tokensToCss, TOKENS_CSS_MODULE } from './src/design/css.js';
import { tokens } from './src/design/tokens.js';

// 개발 서버: /api·/ws를 로컬 하네스 서버(127.0.0.1:3790)로 프록시 → 같은 출처로 호출(CORS 불필요)
const API = process.env.HARNESS_X_API ?? 'http://127.0.0.1:3790';

/** tokens.json → `virtual:hx-tokens.css` (CSS 변수) */
export function tokensCssPlugin(): Plugin {
  const resolved = '\0' + TOKENS_CSS_MODULE;
  return {
    name: 'hx-tokens-css',
    resolveId: (id) => (id === TOKENS_CSS_MODULE ? resolved : undefined),
    load: (id) => (id === resolved ? tokensToCss(tokens) : undefined),
  };
}

export default defineConfig({
  plugins: [react(), tokensCssPlugin()],
  server: {
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
    },
  },
});
