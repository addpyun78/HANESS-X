import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { Composer, type ComposerProps } from '../src/composer/Composer.js';
import type { EngineOption } from '../src/composer/types.js';

export const ENGINES: EngineOption[] = [
  { id: 'claude-code', label: 'Claude Code', available: true },
  { id: 'codex', label: 'Codex', available: true, auth: ['subscription', 'api'] },
  { id: 'antigravity', label: 'Antigravity', available: false },
];

export function renderComposer(props: Partial<ComposerProps> = {}) {
  const onSend = vi.fn();
  const onSettingsChange = vi.fn();
  const onAttach = vi.fn();
  const onPlus = vi.fn();
  const r = render(
    <Composer
      engines={ENGINES}
      onSend={onSend}
      onSettingsChange={onSettingsChange}
      onAttach={onAttach}
      onPlus={onPlus}
      {...props}
    />,
  );
  return { container: r.container as HTMLElement, onSend, onSettingsChange, onAttach, onPlus };
}
