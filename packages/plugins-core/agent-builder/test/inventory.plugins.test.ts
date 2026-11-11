import { describe, expect, it } from 'vitest';
import { collectPlugins } from '../src/inventory/plugins.js';
import { inventoryEnv } from './inventory-helpers.js';

describe('P4-A.2 플러그인 수집 (매니페스트만)', () => {
  it('설치된 플러그인 수와 일치 + id·버전·슬롯·명령·권한·활성 여부', async () => {
    const env = inventoryEnv();
    try {
      const loader = env.loader();
      await loader.loadAll();
      const plugins = collectPlugins(loader.plugins.values());
      expect(plugins).toHaveLength(loader.plugins.size);
      expect(plugins.map((p) => p.id)).toEqual([...loader.plugins.keys()].sort());
      const hello = plugins.find((p) => p.id === 'hello')!;
      expect(hello).toMatchObject({
        version: '0.1.0',
        slots: ['command'],
        commands: ['/hello'],
        permissions: { fs: [], net: [], shell: false },
        enabled: true,
        origin: 'workspace',
        health: 'ready',
      });
      const shot = plugins.find((p) => p.id === 'shot-tool')!;
      expect(shot.slots).toEqual(['tool']);
      expect(shot.permissions).toEqual({ fs: ['workspace:write'], net: [], shell: true });
    } finally {
      env.cleanup();
    }
  });

  it('비활성 플러그인은 enabled=false, health=disabled', () => {
    const manifest = {
      id: 'off',
      version: '1.0.0',
      apiVersion: 1,
      main: 'index.js',
      provides: { command: ['/off'] },
      requires: {},
      permissions: { fs: [], net: [], shell: false },
    };
    const [p] = collectPlugins([{ manifest, dir: '/x', state: 'failed' }]);
    expect(p).toMatchObject({ enabled: false, health: 'disabled' });
  });

  it('module(코드)을 읽지 않는다: 접근하면 던지는 module이 있어도 수집 성공', () => {
    const manifest = {
      id: 'trap',
      version: '1.0.0',
      apiVersion: 1,
      main: 'index.js',
      provides: { tool: ['t'] },
      requires: {},
      permissions: { fs: [], net: [], shell: false },
    };
    const src = {
      manifest,
      dir: '/x',
      state: 'active',
      get module(): never {
        throw new Error('플러그인 코드 접근 금지');
      },
    };
    expect(collectPlugins([src])[0]!.id).toBe('trap');
  });
});
