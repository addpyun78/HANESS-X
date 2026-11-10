import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import { setup } from './fixtures.js';

const PIPELINE = 'name: p\nnodes:\n  - id: main\n    type: role\n';
const agentYaml = (name: string, displayName: string) =>
  `name: ${name}\ndisplayName: ${displayName}\ncommand: /${name}\npipeline: ./pipeline.yaml\n`;

describe('43.4 이름 충돌 규칙', () => {
  it('사용자 > 프로젝트 > 플러그인, 밀린 플러그인은 플러그인id:이름', async () => {
    const env = setup();
    try {
      env.copyHello(); // plugin: hello
      env.copyDesignQaPlugin('qa-pack'); // plugin: design-qa (id qa-pack)
      const userAgents = join(env.home, 'agents');
      const projAgents = join(env.workspace, '.harness-x', 'agents');
      env.writeAgent(userAgents, 'hello', agentYaml('hello', '사용자 hello'), PIPELINE);
      env.writeAgent(projAgents, 'hello', agentYaml('hello', '프로젝트 hello'), PIPELINE);
      env.writeAgent(projAgents, 'design-qa', agentYaml('design-qa', '프로젝트 QA'), PIPELINE);
      env.writeAgent(projAgents, 'proj-only', agentYaml('proj-only', '프로젝트 전용'), PIPELINE);

      const loader = env.loader();
      await loader.loadAll();
      const reg = new AgentRegistry({
        plugins: () => loader.plugins.values(),
        home: env.home,
        workspace: env.workspace,
      });
      const list = reg.list();
      const row = (name: string) => list.find((a) => a.name === name);

      expect(list.map((a) => a.name)).toEqual([
        'design-qa',
        'hello',
        'hello:hello',
        'proj-only',
        'qa-pack:design-qa',
      ]);
      expect(row('hello')).toMatchObject({ source: 'user', command: '/hello' });
      expect(row('hello')!.agent.displayName).toBe('사용자 hello');
      expect(row('design-qa')).toMatchObject({ source: 'project' });
      expect(row('hello:hello')).toMatchObject({
        source: 'plugin',
        pluginId: 'hello',
        command: '/hello:hello',
      });
      expect(row('qa-pack:design-qa')).toMatchObject({ source: 'plugin', command: '/qa-pack:design-qa' });
      expect(row('proj-only')).toMatchObject({ source: 'project' });
      // 프로젝트 hello는 사용자 hello에 가려짐
      expect(reg.shadowed.map((a) => `${a.source}:${a.name}`)).toEqual(['project:hello']);
      expect(reg.get('/hello:hello')?.pluginId).toBe('hello');
    } finally {
      env.cleanup();
    }
  });

  it('플러그인끼리 충돌하면 둘 다 플러그인id:이름', async () => {
    const env = setup();
    try {
      env.copyDesignQaPlugin('pack-a');
      env.copyDesignQaPlugin('pack-b');
      const loader = env.loader();
      await loader.loadAll();
      const reg = new AgentRegistry({ plugins: () => loader.plugins.values(), home: env.home });
      expect(reg.list().map((a) => a.command)).toEqual(['/pack-a:design-qa', '/pack-b:design-qa']);
    } finally {
      env.cleanup();
    }
  });
});
