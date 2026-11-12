import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { hxPlugin } from './scripts/eslint/no-dead-button.js';

export default tseslint.config(
  {
    ignores: [
      '.claude/**',
      '**/node_modules/**',
      '**/dist/**',
      '.harness-x-dev/**',
      '**/*.d.ts',
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/web/test/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // T-101 0C.2·0C.9 눌러도 아무 일 없는 버튼·메뉴 항목·링크 금지 + 상호작용 계약(data-action) (scripts/eslint/no-dead-button.js)
    files: ['apps/web/src/**/*.tsx'],
    plugins: { hx: hxPlugin },
    rules: { 'hx/no-dead-button': ['error', { requireAction: true }] },
  },
);
