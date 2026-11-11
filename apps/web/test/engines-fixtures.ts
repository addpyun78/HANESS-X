import type { ModelOption } from '@harness-x/protocol';
import { vi } from 'vitest';
import type { EngineScanApi } from '../src/engines/api.js';
import type { ScanProgressView } from '../src/engines/model.js';

export const MODELS: ModelOption[] = [
  {
    engineId: 'claude-code',
    modelId: 'sonnet',
    displayName: 'Sonnet',
    auth: 'subscription',
    inputs: { image: true, pdf: true, audio: false },
    status: 'ready',
    engineLabel: 'Claude Code',
  },
  {
    engineId: 'claude-code',
    modelId: 'opus',
    displayName: 'Opus',
    auth: 'subscription',
    inputs: { image: true, pdf: true, audio: false },
    status: 'ready',
    engineLabel: 'Claude Code',
  },
  {
    engineId: 'codex',
    modelId: 'gpt-5.5-codex',
    displayName: 'gpt-5.5-codex',
    auth: 'subscription',
    inputs: { image: true, pdf: false, audio: false },
    status: 'needs-login',
    engineLabel: 'Codex',
  },
  {
    engineId: 'ollama',
    modelId: 'llama3',
    displayName: 'llama3',
    auth: 'local',
    inputs: { image: false, pdf: false, audio: false },
    status: 'ready',
    engineLabel: 'Ollama',
  },
];

export const scanning = (over: Partial<ScanProgressView> = {}): ScanProgressView => ({
  state: 'scanning',
  reason: 'startup',
  engines: [
    { name: 'claude', label: 'Claude Code', state: 'ready' },
    { name: 'codex', label: 'Codex', state: 'needs-login' },
    { name: 'agy', label: 'Antigravity', state: 'checking' },
    { name: 'gemini', label: 'Gemini CLI', state: 'missing' },
    { name: 'ollama', label: 'Ollama', state: 'ready', models: 3 },
  ],
  found: 0,
  added: [],
  removed: [],
  ...over,
});

export const done = (over: Partial<ScanProgressView> = {}): ScanProgressView =>
  scanning({ state: 'done', found: 4, ...over });

/** 진행 상태를 차례로 돌려주는 가짜 API (마지막 값은 계속) */
export function fakeScanApi(
  steps: ScanProgressView[],
  over: Partial<EngineScanApi> = {},
): EngineScanApi & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    scanStatus: vi.fn(async () => {
      calls.push('status');
      return steps[Math.min(i++, steps.length - 1)]!;
    }),
    rescan: vi.fn(async (reason) => {
      calls.push(`rescan:${reason}`);
      return {};
    }),
    models: vi.fn(async () => ({ models: MODELS, scannedAt: '2026-11-12T00:00:00.000Z' })),
    mainAi: vi.fn(async () => ({ main: { engine: 'claude-code', model: 'sonnet' } })),
    setMainAi: vi.fn(async () => ({ ok: true })),
    setSessionAi: vi.fn(async () => ({ ok: true })),
    ...over,
  };
}
