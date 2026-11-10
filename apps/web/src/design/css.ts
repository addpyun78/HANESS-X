import type { DesignTokens, NeutralStep } from './tokens.js';

/**
 * 토큰 → CSS 변수.
 * - 원시 변수: --hx-neutral-100…900, --hx-accent, --hx-<상태>, --hx-space-1…6, --hx-radius, --hx-font-<크기>
 * - 의미 변수(--hx-bg, --hx-text …)는 테마마다 원시 변수를 가리킨다.
 * - 테마: 기본 라이트, prefers-color-scheme: dark면 다크, html[data-theme]가 있으면 그것이 우선(수동 토글).
 */

type Semantic = Record<string, string>;

const n = (s: NeutralStep) => `var(--hx-neutral-${s})`;

export const LIGHT: Semantic = {
  bg: n('100'),
  surface: n('200'),
  'surface-2': n('300'),
  border: n('300'),
  'border-strong': n('400'),
  text: n('900'),
  'text-muted': n('600'),
  'text-faint': n('500'),
  'on-accent': n('100'),
};

export const DARK: Semantic = {
  bg: n('900'),
  surface: n('800'),
  'surface-2': n('700'),
  border: n('700'),
  'border-strong': n('600'),
  text: n('100'),
  'text-muted': n('400'),
  'text-faint': n('500'),
  'on-accent': n('100'),
};

function decls(vars: Record<string, string>, indent = '  '): string {
  return Object.entries(vars)
    .map(([k, v]) => `${indent}--hx-${k}: ${v};`)
    .join('\n');
}

function semantic(t: DesignTokens, s: Semantic, scheme: 'light' | 'dark'): Record<string, string> {
  const soft: Record<string, string> = {};
  for (const name of [...Object.keys(t.color.status), 'accent'])
    soft[`${name}-soft`] = `color-mix(in srgb, var(--hx-${name}) 16%, var(--hx-bg))`;
  return { ...s, ...soft, 'color-scheme': scheme };
}

export function tokensToCss(t: DesignTokens): string {
  const raw: Record<string, string> = {};
  for (const [step, v] of Object.entries(t.color.neutral)) raw[`neutral-${step}`] = v;
  raw.accent = t.color.accent;
  for (const [name, v] of Object.entries(t.color.status)) raw[name] = v;
  t.space.forEach((px, i) => (raw[`space-${i + 1}`] = `${px}px`));
  raw.radius = `${t.radius}px`;
  for (const px of t.font.size) raw[`font-${px}`] = `${px}px`;
  raw['font-body'] = t.font.family.body;
  raw['font-mono'] = t.font.family.mono;

  const light = semantic(t, LIGHT, 'light');
  const dark = semantic(t, DARK, 'dark');
  const withScheme = (v: Record<string, string>) => {
    const { 'color-scheme': scheme, ...rest } = v;
    return `${decls(rest)}\n  color-scheme: ${scheme};`;
  };
  return [
    `/* 자동 생성: apps/web/src/design/tokens.json → css.ts (직접 수정 금지) */`,
    `:root {\n${decls(raw)}\n}`,
    `:root,\n:root[data-theme='light'] {\n${withScheme(light)}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n${withScheme(dark).replace(/^/gm, '  ')}\n  }\n}`,
    `:root[data-theme='dark'] {\n${withScheme(dark)}\n}`,
    '',
  ].join('\n\n');
}

export const TOKENS_CSS_MODULE = 'virtual:hx-tokens.css';
