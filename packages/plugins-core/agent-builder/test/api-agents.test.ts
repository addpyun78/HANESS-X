import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventLog, startApiServer } from '@harness-x/kernel';
import { AgentListResponseSchema } from '@harness-x/protocol';
import { AgentRegistry } from '../src/registry.js';
import { setup } from './fixtures.js';

describe('43.5 GET /api/agents', () => {
  it('응답 스키마: 이름·설명·아이콘·출처·노드 수', async () => {
    const env = setup();
    const log = new EventLog({ root: join(env.dir, 'api-logs') });
    env.copyHello();
    env.copyDesignQaPlugin();
    env.writeAgent(
      join(env.home, 'agents'),
      'mine',
      'name: mine\ndisplayName: 내 것\ncommand: /mine\npipeline: plugin:design-qa/design-qa\n',
    );
    const loader = env.loader();
    await loader.loadAll();
    const registry = new AgentRegistry({ plugins: () => loader.plugins.values(), home: env.home });
    const server = await startApiServer({
      loader,
      log,
      port: 0,
      tokenFile: join(env.home, 'run', 'token'),
      agents: () => registry.summaries(),
    });
    try {
      const unauth = await fetch(server.url + '/api/agents');
      expect(unauth.status).toBe(401);
      const res = await fetch(server.url + '/api/agents', {
        headers: { authorization: `Bearer ${server.token}` },
      });
      expect(res.status).toBe(200);
      const body = AgentListResponseSchema.parse(await res.json());
      expect(body.agents).toEqual([
        {
          name: 'design-qa',
          command: '/design-qa',
          displayName: '디자인 QA',
          description: '계획 → 구현 → 비평 3단계 디자인 QA 에이전트',
          icon: '🎨',
          source: 'plugin',
          pluginId: 'design-qa',
          defaultEngine: 'claude-code',
          nodeCount: 3,
        },
        {
          name: 'hello',
          command: '/hello',
          displayName: 'Hello',
          description: '하네스 플러그인 예제: 활성화 로그와 /hello 명령',
          source: 'plugin',
          pluginId: 'hello',
          defaultEngine: 'auto',
          nodeCount: 1,
        },
        {
          name: 'mine',
          command: '/mine',
          displayName: '내 것',
          source: 'user',
          defaultEngine: 'auto',
          nodeCount: 3,
        },
      ]);
    } finally {
      await server.close();
      log.close();
      env.cleanup();
    }
  });

  it('제공자가 없으면 빈 목록', async () => {
    const env = setup();
    const log = new EventLog({ root: join(env.dir, 'api-logs') });
    const loader = env.loader();
    const server = await startApiServer({ loader, log, port: 0, tokenFile: join(env.home, 'run', 'token') });
    try {
      const res = await fetch(server.url + '/api/agents', {
        headers: { authorization: `Bearer ${server.token}` },
      });
      expect(AgentListResponseSchema.parse(await res.json())).toEqual({ agents: [] });
    } finally {
      await server.close();
      log.close();
      env.cleanup();
    }
  });
});
