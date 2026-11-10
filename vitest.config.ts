import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// @ts-expect-error — 순수 JS 도우미
import { listWorkspacePackages } from './scripts/dev/workspace-packages.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const alias = Object.fromEntries(
  (listWorkspacePackages(root) as { name: string; dir: string }[]).map((p) => [
    p.name,
    `${p.dir}/src/index.ts`,
  ]),
);

const include = ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/**/*.test.ts'];

export default defineConfig({
  resolve: { alias },
  test: {
    include,
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // WSL의 /mnt/c(NTFS) 위에서는 모듈 로딩이 수 초씩 걸리므로 넉넉하게 둔다
    testTimeout: 90_000,
    hookTimeout: 120_000,
    typecheck: {
      enabled: true,
      include,
      tsconfig: './tsconfig.test.json',
    },
  },
});
