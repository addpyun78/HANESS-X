import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 서버: /api·/ws를 로컬 하네스 서버(127.0.0.1:3790)로 프록시 → 같은 출처로 호출(CORS 불필요)
const API = process.env.HARNESS_X_API ?? 'http://127.0.0.1:3790';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
    },
  },
});
