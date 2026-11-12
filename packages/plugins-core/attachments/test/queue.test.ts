import { existsSync, readFileSync } from 'node:fs';
import type { Attachment } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversionQueue, MESSAGES, writeRep, type Converter } from '../src/index.js';
import { makeStore, tempProject } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('1B.1 변환 대기열(동시 2개), 칩 진행 표시, 실패해도 원본 유지', () => {
  it('동시에 2개까지만 돌고, 진행 상태가 converting → ready로 알려진다', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const store = makeStore(p.root);
    const slow: Converter = async (_a, data, ctx) => {
      await tick(30);
      return { representations: [writeRep(ctx, 'text', 'text.txt', data, 'text/plain')], warnings: [] };
    };
    const seen: [string, string][] = [];
    const q = new ConversionQueue({
      store,
      converters: { text: slow },
      onProgress: (a) => seen.push([a.originalName, a.status]),
    });
    const added = await store.addMany(
      's',
      ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: `${n}.txt`, data: Buffer.from(n) })),
    );
    const done = await Promise.all(added.map((r) => q.enqueue(r.attachment)));
    expect(q.peak).toBe(2);
    expect(done.every((a) => a.status === 'ready')).toBe(true);
    expect(seen.filter(([, s]) => s === 'converting')).toHaveLength(5);
    expect(seen.filter(([, s]) => s === 'ready')).toHaveLength(5);
    expect(store.get('s', done[0]!.id)?.representations[0]?.form).toBe('text');
  });

  it('변환이 실패해도 원본 첨부는 그대로, 상태는 failed + 쉬운 말 안내', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const store = makeStore(p.root);
    const broken: Converter = async () => {
      throw new Error('비밀 내용이 섞인 오류 메시지');
    };
    const q = new ConversionQueue({ store, converters: { text: broken } });
    const { attachment } = await store.add('s', { name: '메모.txt', data: Buffer.from('원본 내용') });
    const r: Attachment = await q.enqueue(attachment);
    expect(r.status).toBe('failed');
    expect(r.warnings.map((w) => w.message)).toEqual([MESSAGES.convertFailed]);
    expect(existsSync(r.storedPath)).toBe(true);
    expect(readFileSync(r.storedPath, 'utf8')).toBe('원본 내용');
    const saved = store.get('s', r.id)!;
    expect(saved.status).toBe('failed');
    expect(JSON.stringify(saved)).not.toContain('비밀 내용');
  });
});
