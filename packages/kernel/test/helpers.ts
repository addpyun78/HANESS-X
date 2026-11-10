import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogRecord } from '../src/event-log.js';

export function tempDir(prefix = 'hx-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let seq = 0;
export function textEvent(sessionId: string, text: string, extra: Partial<LogRecord> = {}): LogRecord {
  seq++;
  return {
    id: `e${seq}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date(Date.UTC(2026, 10, 10, 0, 0, 0, seq)).toISOString(),
    sessionId,
    type: 'assistant_text',
    text,
    ...extra,
  };
}
