import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventLog, startApiServer } from '@harness-x/kernel';
import { AgentListResponseSchema } from '@harness-x/protocol';
import { collectAgents, collectPipelines } from '../src/inventory/agents.js';
import { AgentRegistry } from '../src/registry.js';
import { inventoryEnv } from './inventory-helpers.js';

describe('P4-A.6 기존 에이전트·파이프라인 수집', () => {
  it('/api/agents와 일치: 이름·명령 + 노드 요약(역할명·엔진·스킬 id)', async () => {
    const env = inventoryEnv();
    const log = new EventLog({ root: join(env.dir, 'api-logs') });
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
      const res = await fetch(server.url + '/api/agents', {
        headers: { authorization: `Bearer ${server.token}` },
      });
      const api = AgentListResponseSchema.parse(await res.json()).agents;
      const agents = collectAgents(registry.list());
      expect(agents.map((a) => [a.name, a.command, a.source])).toEqual(
        api.map((a) => [a.name, a.command, a.source]),
      );
      expect(agents.map((a) => a.nodes.length)).toEqual(api.map((a) => a.nodeCount));

      const qa = agents.find((a) => a.name === 'design-qa')!;
      expect(qa.nodes.map((n) => [n.id, n.type, n.engine])).toEqual([
        ['plan', 'role', 'claude-code'],
        ['build', 'role', 'codex'],
        ['critic', 'role', 'antigravity'],
      ]);
      expect(qa.nodes.every((n) => n.label && Array.isArray(n.skills))).toBe(true);
      // 지시문(prompt)·스키마 본문은 넣지 않는다
      expect(JSON.stringify(agents)).not.toMatch(/"prompt"|outputSchema/);

      const pipelines = collectPipelines(loader.plugins.values());
      expect(pipelines.map((p) => p.id)).toEqual(['design-qa/design-qa']);
      expect(pipelines[0]!.nodes).toHaveLength(qa.nodes.length);
    } finally {
      await server.close();
      log.close();
      env.cleanup();
    }
  });

  it('노드가 쓰는 엔진 상태가 에이전트 건강 상태에 반영', async () => {
    const env = inventoryEnv();
    try {
      const loader = env.loader();
      await loader.loadAll();
      const registry = new AgentRegistry({ plugins: () => loader.plugins.values(), home: env.home });
      const engines = new Map([
        ['claude-code', 'ready' as const],
        ['codex', 'needs-login' as const],
        ['antigravity', 'ready' as const],
      ]);
      expect(collectAgents(registry.list(), engines).find((a) => a.name === 'design-qa')!.health).toBe(
        'needs-login',
      );
      expect(collectPipelines(loader.plugins.values(), engines)[0]!.health).toBe('needs-login');
      // 엔진 탐지 결과가 없으면 판단하지 않음
      expect(collectAgents(registry.list()).find((a) => a.name === 'design-qa')!.health).toBe('ready');
    } finally {
      env.cleanup();
    }
  });
});
