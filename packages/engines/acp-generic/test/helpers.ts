import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HarnessEvent } from '@harness-x/protocol';
import { AcpEngine, type AcpEngineConfig } from '../src/index.js';

export const MOCK_AGENT = fileURLToPath(new URL('./mock-acp-agent.mjs', import.meta.url));

export function mockEngine(
  extra: Partial<AcpEngineConfig> = {},
  env: Record<string, string> = {},
): AcpEngine {
  return new AcpEngine({
    id: 'mock-acp',
    displayName: 'Mock ACP',
    command: process.execPath,
    args: [MOCK_AGENT],
    env,
    shutdownGraceMs: 1000,
    ...extra,
  });
}

export function tempDir(prefix = 'hx-acp-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function collect(events: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}
