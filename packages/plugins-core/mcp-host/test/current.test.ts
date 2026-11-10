import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { call, connectHttp, item, tempDir } from './helpers.js';

// 23.4 checklist.current(): 현재 항목 + 정식 경로 + 다음 3개 — 반환 스키마 테스트
const ItemViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['todo', 'doing', 'verifying', 'done', 'failed', 'blocked']),
  attempts: z.number().int(),
  artifactId: z.string(),
  canonicalPath: z.string().nullable(),
});
const CurrentSchema = z
  .object({
    item: ItemViewSchema.extend({
      acceptance: z.array(z.looseObject({ type: z.string() })),
      deps: z.array(z.string()),
    })
      .strict()
      .nullable(),
    canonicalPath: z.string().nullable(),
    next: z.array(ItemViewSchema.strict()).max(3),
    remaining: z.number().int(),
  })
  .strict();

describe('23.4 checklist.current', () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  it('현재 항목·정식 경로·다음 3개, structuredContent도 같은 값', async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const c = await connectHttp(t.dir);
    cleanups.push(c.close);

    const empty = await call(c.client, 'checklist.current');
    expect(CurrentSchema.parse(empty.body)).toEqual({
      item: null,
      canonicalPath: null,
      next: [],
      remaining: 0,
    });

    await call(c.client, 'checklist.propose', {
      items: [
        item('1', { artifactId: 'art.mobile-app' }),
        item('2', { deps: ['1'] }),
        item('3'),
        item('4'),
        item('5'),
      ],
      artifacts: [{ artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' }],
    });
    await call(c.client, 'checklist.start', { id: '1' });
    const raw = await c.client.callTool({ name: 'checklist.current', arguments: {} });
    const r = CurrentSchema.parse(JSON.parse((raw.content as { text: string }[])[0]!.text));
    expect(raw.structuredContent).toEqual(r);
    expect(r.item).toMatchObject({ id: '1', status: 'doing', artifactId: 'art.mobile-app' });
    expect(r.canonicalPath).toBe('harness/mobile');
    expect(r.next.map((i) => i.id)).toEqual(['2', '3', '4']);
    expect(r.next[0]!.canonicalPath).toBeNull(); // manifest에 없는 산출물
    expect(r.remaining).toBe(5);
  });
});
