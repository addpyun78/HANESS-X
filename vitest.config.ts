import { defineConfig } from 'vitest/config';

const include = ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.ts'];

export default defineConfig({
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
