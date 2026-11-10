import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import { setup } from './fixtures.js';

const PIPELINE = 'name: solo\nnodes:\n  - id: main\n    type: role\n    engine: codex\n';
const agentYaml = (name: string, extra = '') =>
  `name: ${name}\ndisplayName: ${name} 에이전트\ncommand: /${name}\npipeline: ./pipeline.yaml\n${extra}`;

const prevHome = process.env.HARNESS_X_HOME;
afterEach(() => {
  if (prevHome === undefined) delete process.env.HARNESS_X_HOME;
  else process.env.HARNESS_X_HOME = prevHome;
});

describe('43.3 사용자 에이전트 ~/.harness-x/agents/*/agent.yaml', () => {
  it('HARNESS_X_HOME 아래 사용자 에이전트가 목록에 포함', () => {
    const env = setup();
    try {
      process.env.HARNESS_X_HOME = env.home;
      const agents = join(env.home, 'agents');
      env.writeAgent(agents, 'solo', agentYaml('solo', 'icon: "🤖"\ndescription: 혼자 일함\n'), PIPELINE);
      env.writeAgent(agents, 'broken', 'name: Broken\n');
      env.writeAgent(agents, 'no-pipeline', agentYaml('no-pipeline'));
      const reg = new AgentRegistry(); // 기본 home = harnessHome()
      const list = reg.list();
      expect(list.map((a) => a.name)).toEqual(['solo']);
      expect(list[0]).toMatchObject({ source: 'user', command: '/solo', dir: join(agents, 'solo') });
      expect(list[0]!.pipeline.nodes[0]).toMatchObject({ engine: 'codex' });
      expect(reg.summaries()).toEqual([
        {
          name: 'solo',
          command: '/solo',
          displayName: 'solo 에이전트',
          description: '혼자 일함',
          icon: '🤖',
          source: 'user',
          defaultEngine: 'auto',
          nodeCount: 1,
        },
      ]);
      expect(reg.issues.map((i) => i.path).sort()).toEqual([
        join(agents, 'broken', 'agent.yaml'),
        join(agents, 'no-pipeline', 'agent.yaml'),
      ]);
    } finally {
      env.cleanup();
    }
  });

  it('plugin: 파이프라인 참조·인라인 파이프라인, 저장 직후 다시 읽으면 바로 등장', async () => {
    const env = setup();
    try {
      env.copyDesignQaPlugin();
      const loader = env.loader();
      await loader.loadAll();
      const reg = new AgentRegistry({ plugins: () => loader.plugins.values(), home: env.home });
      expect(reg.list().map((a) => a.name)).toEqual(['design-qa']);
      const agents = join(env.home, 'agents');
      env.writeAgent(
        agents,
        'my-qa',
        'name: my-qa\ndisplayName: 내 QA\ncommand: /my-qa\npipeline: plugin:design-qa/design-qa\n',
      );
      env.writeAgent(
        agents,
        'inline',
        'name: inline\ndisplayName: 인라인\ncommand: /inline\npipeline:\n  name: inline\n  nodes:\n    - id: a\n      type: role\n    - id: b\n      type: role\n  edges:\n    - { from: a, to: b }\n',
      );
      const byName = Object.fromEntries(reg.summaries().map((s) => [s.name, s]));
      expect(Object.keys(byName)).toEqual(['design-qa', 'inline', 'my-qa']);
      expect(byName['my-qa']).toMatchObject({ source: 'user', nodeCount: 3 });
      expect(byName['inline']).toMatchObject({ source: 'user', nodeCount: 2 });
    } finally {
      env.cleanup();
    }
  });
});
