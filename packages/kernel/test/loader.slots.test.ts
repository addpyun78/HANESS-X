import { afterEach, describe, expect, it } from 'vitest';
import { engineManifest, makePlugin, setup } from './plugin-fixtures.js';

describe('슬롯 최소 1개 규칙', () => {
  let env: ReturnType<typeof setup>;
  afterEach(() => env.cleanup());

  it('마지막 engine 비활성 시도 거부', async () => {
    env = setup();
    makePlugin(env.userRoot, engineManifest('engine-a'));
    makePlugin(env.userRoot, engineManifest('engine-b'));
    const loader = env.mk();
    await loader.loadAll();
    await loader.deactivate('engine-a'); // 아직 engine-b가 남음 → 허용
    expect(loader.activeBySlot().engine).toEqual(['engine-b']);
    await expect(loader.deactivate('engine-b')).rejects.toThrow(/슬롯 최소 1개 규칙/);
    expect(loader.plugins.get('engine-b')?.state).toBe('active');
    expect(env.log.query({ type: 'plugin_deactivate_denied' })).toHaveLength(1);
  });

  it('의존 중인 플러그인은 비활성 거부', async () => {
    env = setup();
    makePlugin(env.userRoot, { id: 'base', version: '1.0.0', apiVersion: 1, provides: { tool: ['t'] } });
    makePlugin(env.userRoot, engineManifest('uses-base', { requires: { base: '^1' } }));
    const loader = env.mk();
    await loader.loadAll();
    await expect(loader.deactivate('base')).rejects.toThrow(/의존 중/);
  });
});
