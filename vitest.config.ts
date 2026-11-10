import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

const include = ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.ts'];

export default defineConfig({
  resolve: {
    alias: {
      '@harness-x/protocol': src('protocol'),
      '@harness-x/kernel': src('kernel'),
      '@harness-x/sdk': src('sdk'),
    },
  },
  test: {
    include,
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // WSL의 /mnt/c(NTFS) 위에서는 모듈 로딩이 수 초씩 걸리므로 넉넉하게 둔다
    testTimeout: 30_000,
    hookTimeout: 120_000,
    typecheck: {
      enabled: true,
      include,
      tsconfig: './tsconfig.test.json',
    },
  },
});
