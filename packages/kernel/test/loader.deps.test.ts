import { afterEach, describe, expect, it } from 'vitest';
import { engineManifest, makePlugin, setup } from './plugin-fixtures.js';

describe('의존성 위상정렬', () => {
  let env: ReturnType<typeof setup>;
  afterEach(() => env.cleanup());

  it('의존 순서대로 활성화', async () => {
    env = setup();
    const order: string[] = [];
    (globalThis as Record<string, unknown>).__hxOrder = order;
    const code = (id: string) => `export function activate(){ globalThis.__hxOrder.push('${id}') }`;
    makePlugin(env.userRoot, engineManifest('c-plugin', { requires: { 'b-plugin': '^1.0.0' } }), code('c'));
    makePlugin(env.userRoot, engineManifest('a-plugin'), code('a'));
    makePlugin(env.userRoot, engineManifest('b-plugin', { requires: { 'a-plugin': '>=1' } }), code('b'));
    const active = await env.mk().loadAll();
    expect(active).toEqual(['a-plugin', 'b-plugin', 'c-plugin']);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('순환 샘플 거부', async () => {
    env = setup();
    makePlugin(env.userRoot, engineManifest('x-plugin', { requires: { 'y-plugin': '*' } }));
    makePlugin(env.userRoot, engineManifest('y-plugin', { requires: { 'z-plugin': '*' } }));
    makePlugin(env.userRoot, engineManifest('z-plugin', { requires: { 'x-plugin': '*' } }));
    makePlugin(env.userRoot, engineManifest('ok-plugin'));
    const loader = env.mk();
    const active = await loader.loadAll();
    expect(active).toEqual(['ok-plugin']);
    const cyc = loader.rejections.filter((r) => r.reason.startsWith('의존성 순환'));
    expect(cyc.map((r) => r.id).sort()).toEqual(['x-plugin', 'y-plugin', 'z-plugin']);
  });

  it('없는 의존·버전 불일치는 연쇄 거부', async () => {
    env = setup();
    makePlugin(env.userRoot, engineManifest('needs-missing', { requires: { ghost: '^1' } }));
    makePlugin(env.userRoot, engineManifest('needs-new-a', { requires: { 'old-a': '^2' } }));
    makePlugin(env.userRoot, engineManifest('old-a'));
    makePlugin(env.userRoot, engineManifest('chain', { requires: { 'needs-missing': '*' } }));
    const loader = env.mk();
    expect(await loader.loadAll()).toEqual(['old-a']);
    expect(loader.rejections.map((r) => r.id).sort()).toEqual(['chain', 'needs-missing', 'needs-new-a']);
  });
});
