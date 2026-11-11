import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventLog, startApiServer } from '@harness-x/kernel';
import { AgentListResponseSchema } from '@harness-x/protocol';
import { AgentRegistry } from '../src/registry.js';
import { setup } from './fixtures.js';

describe('46.5 저장 즉시 / 목록에 등장 (핫리로드)', () => {
  it('PUT /api/agents/:name 저장 후 3초 안에 GET /api/agents에 포함', async () => {
    const env = setup();
    const log = new EventLog({ root: join(env.dir, 'api-logs') });
    env.copyHello();
    const loader = env.loader();
    await loader.loadAll();
    const registry = new AgentRegistry({ plugins: () => loader.plugins.values(), home: env.home });
    const server = await startApiServer({
      loader,
      log,
      port: 0,
      tokenFile: join(env.home, 'run', 'token'),
      agents: () => registry.summaries(),
      agentsHome: env.home,
    });
    const auth = { authorization: `Bearer ${server.token}` };
    const list = async () =>
      AgentListResponseSchema.parse(await (await fetch(server.url + '/api/agents', { headers: auth })).json())
        .agents;
    try {
      expect((await list()).map((a) => a.name)).toEqual(['hello']);
      // P4-F.2: 저장은 사람 클릭 토큰(save-agent)이 있어야 한다
      const gesture = (await (
        await fetch(server.url + '/api/gesture-tokens', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'save-agent' }),
        })
      ).json()) as { token: string };
      const t0 = Date.now();
      const res = await fetch(server.url + '/api/agents/ui-review', {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/json', 'x-harness-gesture': gesture.token },
        body: JSON.stringify({
          agent: { name: 'ui-review', displayName: 'UI 리뷰', icon: '🔍' },
          pipeline: {
            name: 'ui-review',
            nodes: [
              { id: 'plan', type: 'role' },
              { id: 'build', type: 'role' },
              { id: 'critic', type: 'role' },
            ],
            edges: [
              { from: 'plan', to: 'build' },
              { from: 'build', to: 'critic' },
            ],
          },
        }),
      });
      expect(res.status).toBe(201);
      let found;
      while (!found && Date.now() - t0 < 3000) {
        found = (await list()).find((a) => a.name === 'ui-review');
        if (!found) await new Promise((r) => setTimeout(r, 100));
      }
      const elapsed = Date.now() - t0;
      expect(found).toEqual({
        name: 'ui-review',
        command: '/ui-review',
        displayName: 'UI 리뷰',
        icon: '🔍',
        source: 'user',
        defaultEngine: 'auto',
        nodeCount: 3,
      });
      expect(elapsed).toBeLessThan(3000);
    } finally {
      await server.close();
      log.close();
      env.cleanup();
    }
  });
});
