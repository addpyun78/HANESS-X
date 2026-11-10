import { afterEach, describe, expect, it } from 'vitest';
import { engineManifest, makePlugin, setup } from './plugin-fixtures.js';

describe('activate/deactivate 생명주기', () => {
  let env: ReturnType<typeof setup>;
  afterEach(() => env.cleanup());

  it('hello가 activate 로그 출력', async () => {
    env = setup();
    env.copyHello();
    const loader = env.mk();
    expect(await loader.loadAll()).toEqual(['hello']);
    expect(env.lines).toContain('[hello] activate hello@0.1.0 (hello-v1)');
    const logs = env.log.query({ sessionId: 'kernel', type: 'plugin_log' });
    expect(logs.map((l) => l.message)).toContain('activate hello@0.1.0 (hello-v1)');
    // 플러그인이 등록한 훅 동작
    await env.hooks.emit('session.start', { sessionId: 's9' });
    expect(env.lines).toContain('[hello] hello, session s9');
    // deactivate → 훅 해제
    await loader.deactivate('hello');
    expect(loader.plugins.get('hello')?.state).toBe('inactive');
    expect(env.hooks.list('session.start')).toHaveLength(0);
  });

  it('activate 예외 → failed, 훅 정리', async () => {
    env = setup();
    makePlugin(
      env.userRoot,
      engineManifest('bad-activate'),
      `export function activate(ctx){ ctx.hooks.onNotify('turn.end', ()=>{}); throw new Error('nope') }`,
    );
    const loader = env.mk();
    expect(await loader.loadAll()).toEqual([]);
    expect(loader.plugins.get('bad-activate')).toMatchObject({ state: 'failed', error: 'nope' });
    expect(env.hooks.list('turn.end')).toHaveLength(0);
  });
});
