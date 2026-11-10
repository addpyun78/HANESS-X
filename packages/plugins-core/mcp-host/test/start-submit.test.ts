import { afterEach, describe, expect, it } from 'vitest';
import { call, connectStdio, item, tempDir } from './helpers.js';

// 23.3 checklist.start(id), checklist.submit(id, evidence): 상태 전이 확인
describe('23.3 checklist.start / submit', () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  it('todo → doing → verifying, 증거 기록, 잘못된 전이는 오류', async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const c = await connectStdio(t.dir);
    cleanups.push(c.close);
    await call(c.client, 'checklist.propose', { items: [item('1'), item('2')] });

    const early = await call(c.client, 'checklist.submit', { id: '1' });
    expect(early.isError).toBe(true);
    expect(early.body.error).toBe('INVALID_TRANSITION');

    const s = await call(c.client, 'checklist.start', { id: '1' });
    expect(s.body).toMatchObject({ id: '1', status: 'doing', attempts: 1 });

    const sub = await call(c.client, 'checklist.submit', {
      id: '1',
      evidence: [{ kind: 'test_output', summary: 'pnpm test item-1 exit 0' }],
    });
    expect(sub.body).toMatchObject({ id: '1', status: 'verifying' });
    const ev = c.deps.ledger.item('1').evidence;
    expect(ev.map((e) => e.kind)).toEqual(['test_output']);

    const again = await call(c.client, 'checklist.start', { id: '1' });
    expect(again.isError).toBe(true);
    const missing = await call(c.client, 'checklist.start', { id: 'zzz' });
    expect(missing.body.error).toBe('ITEM_NOT_FOUND');
  });
});
