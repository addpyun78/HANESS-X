import { afterEach, describe, expect, it } from 'vitest';
import { call, connectStdio, item, tempDir } from './helpers.js';

// 23.5 manifest.resolve(artifactId): 정식 경로 반환
describe('23.5 manifest.resolve', () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  it('잠긴 manifest의 정식 경로, 없는 산출물은 UNKNOWN_ARTIFACT', async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const c = await connectStdio(t.dir);
    cleanups.push(c.close);
    await call(c.client, 'checklist.propose', {
      items: [item('1', { artifactId: 'art.mobile-app' }), item('2', { artifactId: 'art.agent-settings' })],
      artifacts: [
        { artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' },
        { artifactId: 'art.agent-settings', displayName: '에이전트 설정.json', kind: 'file' },
      ],
    });
    const r = await call(c.client, 'manifest.resolve', { artifactId: 'art.mobile-app' });
    expect(r.body).toEqual({
      artifactId: 'art.mobile-app',
      displayName: '하네스/모바일',
      path: 'harness/mobile',
      kind: 'dir',
    });
    const f = await call(c.client, 'manifest.resolve', { artifactId: 'art.agent-settings' });
    expect(f.body.path).toBe('agent-settings.json');
    const miss = await call(c.client, 'manifest.resolve', { artifactId: 'art.nope' });
    expect(miss.isError).toBe(true);
    expect(miss.body.error).toBe('UNKNOWN_ARTIFACT');
  });
});
