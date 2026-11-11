import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentStore, type AttachmentStoreOptions } from '../src/index.js';

export function tempProject(prefix = 'hx-att-'): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function makeStore(root: string, extra: Partial<AttachmentStoreOptions> = {}): AttachmentStore {
  return new AttachmentStore({ projectRoot: root, ...extra });
}
