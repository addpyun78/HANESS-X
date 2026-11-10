import { afterEach, describe, expect, it } from 'vitest';
import { call, connectHttp, item, tempDir } from './helpers.js';

// 23.2 checklist.propose(tree): 린터 통과 시 저장, 실패 시 사유 반환
describe('23.2 checklist.propose', () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  async function setup() {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const c = await connectHttp(t.dir);
    cleanups.push(c.close);
    return c;
  }

  it('린터 통과 → checklist.json 저장 (+ artifacts 주면 manifest Lock)', async () => {
    const c = await setup();
    const r = await call(c.client, 'checklist.propose', {
      items: [item('1', { artifactId: 'art.mobile-app' }), item('2', { deps: ['1'] })],
      artifacts: [{ artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' }],
    });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({
      ok: true,
      revision: 1,
      itemCount: 2,
      manifest: { status: 'locked', artifacts: { 'art.mobile-app': 'harness/mobile' } },
    });
    expect(c.deps.ledger.get().items.map((i) => i.id)).toEqual(['1', '2']);
    expect(c.deps.manifest.isLocked()).toBe(true);
  });

  it('린터 위반 → 저장하지 않고 violations + 재분해 요청 메시지', async () => {
    const c = await setup();
    const r = await call(c.client, 'checklist.propose', {
      items: [
        item('1', { title: '로그인 화면 만들고 테스트 작성' }),
        item('2', { artifactId: ['a', 'b'] as never }),
      ],
    });
    expect(r.body.ok).toBe(false);
    expect(r.body.reason).toBe('lint');
    const rules = (r.body.violations as { rule: string; itemId: string }[]).map(
      (v) => `${v.rule}:${v.itemId}`,
    );
    expect(rules).toEqual(expect.arrayContaining(['R1:1', 'R2:2']));
    expect(r.body.message).toMatch(/재분해 요청/);
    expect(c.deps.ledger.read()).toBeNull();
  });

  it('이미 있으면 개정(v2), 스키마 오류는 invalid', async () => {
    const c = await setup();
    await call(c.client, 'checklist.propose', { items: [item('1')] });
    const r2 = await call(c.client, 'checklist.propose', { items: [item('1'), item('2')] });
    expect(r2.body).toMatchObject({ ok: true, revision: 2, itemCount: 2 });
    const bad = await call(c.client, 'checklist.propose', { items: [item('3', { deps: ['nope'] })] });
    expect(bad.body).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
