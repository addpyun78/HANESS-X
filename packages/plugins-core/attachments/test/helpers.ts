import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Attachment } from '@harness-x/protocol';
import {
  AttachmentStore,
  ConversionQueue,
  type AttachmentStoreOptions,
  type ConvertContext,
  type Converter,
  type ExternalTools,
  type ToolRunResult,
} from '../src/index.js';

export function tempProject(prefix = 'hx-att-'): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function makeStore(root: string, extra: Partial<AttachmentStoreOptions> = {}): AttachmentStore {
  return new AttachmentStore({ projectRoot: root, ...extra });
}

/** 바깥 도구 흉내: 있는 도구 목록 + 실행 기록 */
export function fakeTools(
  have: Record<string, (args: readonly string[]) => Partial<ToolRunResult> | void> = {},
): ExternalTools & { calls: { command: string; args: readonly string[] }[] } {
  const calls: { command: string; args: readonly string[] }[] = [];
  return {
    calls,
    which: (name) => (name in have ? `/fake/bin/${name}` : undefined),
    run: async (command, args) => {
      calls.push({ command, args });
      const name = command.split('/').pop()!;
      const r = have[name]?.(args);
      return { code: 0, stdout: Buffer.alloc(0), stderr: '', ...(r ?? {}) };
    },
  };
}

/** 저장 + 변환 한 번 (대기열 사용) */
export async function addAndConvert(
  root: string,
  name: string,
  data: Buffer,
  converters: Partial<Record<Attachment['kind'], Converter>>,
  context: Partial<Omit<ConvertContext, 'dir'>> = {},
): Promise<Attachment> {
  const store = makeStore(root);
  const { attachment } = await store.add('s', { name, data });
  const q = new ConversionQueue({ store, converters, context: { tools: fakeTools(), ...context } });
  return q.enqueue(attachment);
}
