import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import { setup } from './fixtures.js';

describe('43.1 provides.command만 있는 플러그인', () => {
  it('hello 플러그인이 단일 role 노드 에이전트로 등록', async () => {
    const env = setup();
    try {
      env.copyHello();
      const loader = env.loader();
      await loader.loadAll();
      const reg = new AgentRegistry({ plugins: () => loader.plugins.values(), home: env.home });
      const agents = reg.list();
      expect(agents).toHaveLength(1);
      const hello = agents[0]!;
      expect(hello).toMatchObject({ name: 'hello', command: '/hello', source: 'plugin', pluginId: 'hello' });
      expect(hello.agent.displayName).toBe('Hello');
      expect(hello.pipeline.nodes).toHaveLength(1);
      expect(hello.pipeline.nodes[0]).toMatchObject({
        id: 'main',
        type: 'role',
        engine: 'auto',
        prompt: '/hello',
      });
      expect(reg.get('/hello')?.name).toBe('hello');
    } finally {
      env.cleanup();
    }
  });

  it('다른 슬롯도 제공하거나 비활성인 플러그인은 명령 에이전트를 만들지 않음', () => {
    const base = {
      version: '1.0.0',
      apiVersion: 1,
      main: 'index.js',
      requires: {},
      permissions: { fs: [], net: [], shell: false },
    };
    const reg = new AgentRegistry({
      home: '/nonexistent-hx-home',
      plugins: () => [
        {
          dir: '/x/a',
          state: 'active',
          manifest: { ...base, id: 'mixed', provides: { command: ['/mixed'], hook: ['h'] } },
        },
        { dir: '/x/b', state: 'failed', manifest: { ...base, id: 'off', provides: { command: ['/off'] } } },
        {
          dir: '/x/c',
          state: 'active',
          manifest: { ...base, id: 'two', provides: { command: ['/one', '/two'] } },
        },
      ],
    });
    expect(reg.list().map((a) => a.command)).toEqual(['/one', '/two']);
  });
});
