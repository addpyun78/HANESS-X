import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import { setup } from './fixtures.js';

describe('43.2 provides.pipeline 플러그인', () => {
  it('design-qa 플러그인 → design-qa 파이프라인 에이전트 등록', async () => {
    const env = setup();
    try {
      env.copyDesignQaPlugin();
      env.copyHello();
      const loader = env.loader();
      await loader.loadAll();
      const reg = new AgentRegistry({ plugins: () => loader.plugins.values(), home: env.home });
      const qa = reg.get('/design-qa');
      expect(qa).toBeDefined();
      expect(qa).toMatchObject({ name: 'design-qa', source: 'plugin', pluginId: 'design-qa' });
      // 폴더의 agent.yaml 메타 사용
      expect(qa!.agent).toMatchObject({ displayName: '디자인 QA', icon: '🎨', defaultEngine: 'claude-code' });
      expect(qa!.agent.pipeline).toBe('plugin:design-qa/design-qa');
      expect(qa!.pipeline.nodes.map((n) => n.id)).toEqual(['plan', 'build', 'critic']);
      expect(reg.list().map((a) => a.name)).toEqual(['design-qa', 'hello']);
    } finally {
      env.cleanup();
    }
  });

  it('pipelines/<이름>.yaml 우선, agent.yaml 없으면 기본 메타, 파일 없으면 문제 기록', async () => {
    const env = setup();
    try {
      const dir = env.copyDesignQaPlugin('multi');
      rmSync(join(dir, 'agent.yaml'));
      writeFileSync(
        join(dir, 'harness-plugin.json'),
        JSON.stringify({
          id: 'multi',
          version: '0.1.0',
          apiVersion: 1,
          description: '여러 파이프라인',
          provides: { pipeline: ['design-qa', 'quick', 'missing'] },
        }),
      );
      mkdirSync(join(dir, 'pipelines'));
      writeFileSync(
        join(dir, 'pipelines', 'quick.yaml'),
        'name: quick\nnodes:\n  - id: only\n    type: role\n',
      );
      const loader = env.loader();
      await loader.loadAll();
      const reg = new AgentRegistry({ plugins: () => loader.plugins.values(), home: env.home });
      const list = reg.list();
      expect(list.map((a) => a.command)).toEqual(['/design-qa', '/quick']);
      expect(list[1]!.agent).toMatchObject({ displayName: 'quick', description: '여러 파이프라인' });
      expect(reg.issues).toHaveLength(1);
      expect(reg.issues[0]!.reason).toContain("'missing'");
    } finally {
      env.cleanup();
    }
  });
});
