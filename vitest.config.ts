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
    typecheck: {
      enabled: true,
      include,
      tsconfig: './tsconfig.test.json',
    },
  },
});
