import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChecklistItemInput } from '../src/schema.js';

export function tempDir(prefix = 'hx-ledger-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function item(id: string, extra: Partial<ChecklistItemInput> = {}): ChecklistItemInput {
  return {
    id,
    title: `항목 ${id} 구현`,
    artifactId: `art.item-${id.replace(/\./g, '-')}`,
    acceptance: [{ type: 'test', run: `pnpm test item-${id}` }],
    ...extra,
  };
}
