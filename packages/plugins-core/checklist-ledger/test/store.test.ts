import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LockBusyError, withFileLock } from '../src/fs-util.js';
import { parseItem } from '../src/schema.js';
import { ChecklistStore, VersionConflictError } from '../src/store.js';
import { item, tempDir } from './helpers.js';

describe('20.3 checklist.json 저장', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  function setup() {
    const t = tempDir();
    cleanup = t.cleanup;
    return { dir: t.dir, store: new ChecklistStore({ dir: t.dir }) };
  }

  it('쓰기마다 버전 1 증가, 원자적 저장(임시 파일 남지 않음)', () => {
    const { dir, store } = setup();
    expect(store.read()).toBeNull();
    expect(store.version()).toBe(0);
    const v1 = store.update(() => ({ revision: 1, items: [parseItem(item('1'))] }), { expectedVersion: 0 });
    expect(v1.version).toBe(1);
    const v2 = store.update((c) => ({ revision: 1, items: c!.items }), { expectedVersion: 1 });
    expect(v2.version).toBe(2);
    const onDisk = JSON.parse(readFileSync(join(dir, 'checklist.json'), 'utf8'));
    expect(onDisk.version).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(['checklist.json']);
  });

  it('동시 쓰기 2개 중 하나 거부 (같은 버전을 읽은 두 작성자)', () => {
    const { store, dir } = setup();
    store.update(() => ({ revision: 1, items: [parseItem(item('1'))] }), { expectedVersion: 0 });
    const writerA = new ChecklistStore({ dir });
    const writerB = new ChecklistStore({ dir });
    const seenA = writerA.read()!.version;
    const seenB = writerB.read()!.version;
    expect(seenA).toBe(seenB);

    const results = [writerA, writerB].map((w, k) => {
      try {
        return w.update(
          (c) => ({
            revision: 1,
            items: c!.items.map((i) => ({ ...i, title: `writer ${k}` })),
          }),
          { expectedVersion: k === 0 ? seenA : seenB },
        );
      } catch (err) {
        return err;
      }
    });
    const ok = results.filter((r) => !(r instanceof Error));
    const rejected = results.filter((r) => r instanceof VersionConflictError);
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as VersionConflictError).actual).toBe(2);
    expect(store.read()!.items[0]!.title).toBe('writer 0');
    expect(store.read()!.version).toBe(2);
  });

  it('동시 비동기 작성자 10개 → 정확히 1개만 성공', async () => {
    const { store, dir } = setup();
    store.update(() => ({ revision: 1, items: [parseItem(item('1'))] }), { expectedVersion: 0 });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, async (_, k) => {
        const w = new ChecklistStore({ dir });
        const seen = w.version();
        await new Promise((r) => setTimeout(r, 5));
        return w.update((c) => ({ revision: 1, items: c!.items.map((i) => ({ ...i, owner: `w${k}` })) }), {
          expectedVersion: seen,
        });
      }),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rej = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(rej).toHaveLength(9);
    for (const r of rej) expect(r.reason).toBeInstanceOf(VersionConflictError);
  });

  it('다른 프로세스가 잠금을 쥐고 있으면 대기 후 LockBusyError, 파일 불변', () => {
    const { store } = setup();
    store.update(() => ({ revision: 1, items: [parseItem(item('1'))] }), { expectedVersion: 0 });
    const busy = new ChecklistStore({ dir: store.dir, lock: { waitMs: 50 } });
    withFileLock(`${store.file}.lock`, () => {
      expect(() => busy.update((c) => ({ revision: 1, items: c!.items }))).toThrow(LockBusyError);
    });
    expect(store.version()).toBe(1);
    // 잠금 해제 후에는 성공
    expect(busy.update((c) => ({ revision: 1, items: c!.items })).version).toBe(2);
  });

  it('fn 예외·스키마 위반 시 파일 불변', () => {
    const { store } = setup();
    store.update(() => ({ revision: 1, items: [parseItem(item('1'))] }));
    expect(() =>
      store.update(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(() =>
      store.update(() => ({ revision: 1, items: [parseItem(item('1')), parseItem(item('1'))] })),
    ).toThrow();
    expect(store.version()).toBe(1);
  });

  it('손상된 파일은 읽기 거부', () => {
    const { store } = setup();
    writeFileSync(store.file, JSON.stringify({ schemaVersion: 1, version: 'x' }));
    expect(() => store.read()).toThrow();
  });
});
