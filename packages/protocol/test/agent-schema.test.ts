import { describe, expect, it } from 'vitest';
import { AgentSchema, parseAgentYaml, parsePluginPipelineRef, stringifyAgent } from '../src/agent.js';

const SAMPLE = `
name: design-qa
displayName: 디자인 QA
description: 계획 → 구현 → 비평
icon: "🎨"
command: /design-qa
defaultEngine: claude-code
pipeline: ./pipeline.yaml
`;

describe('40.4 agent.yaml 스키마', () => {
  it('샘플 통과', () => {
    const a = parseAgentYaml(SAMPLE);
    expect(a).toEqual({
      name: 'design-qa',
      displayName: '디자인 QA',
      description: '계획 → 구현 → 비평',
      icon: '🎨',
      command: '/design-qa',
      defaultEngine: 'claude-code',
      pipeline: './pipeline.yaml',
    });
    expect(parseAgentYaml(stringifyAgent(a))).toEqual(a);
  });

  it('플러그인 파이프라인 참조·인라인 파이프라인 통과, defaultEngine 기본 auto', () => {
    const a = AgentSchema.parse({
      name: 'qa',
      displayName: 'QA',
      command: '/qa',
      pipeline: 'plugin:design-qa/design-qa',
    });
    expect(a.defaultEngine).toBe('auto');
    expect(parsePluginPipelineRef(a.pipeline as string)).toEqual({
      pluginId: 'design-qa',
      pipeline: 'design-qa',
    });
    const inline = AgentSchema.parse({
      name: 'solo',
      displayName: 'Solo',
      command: '/solo',
      pipeline: { name: 'solo', nodes: [{ id: 'main', type: 'role' }] },
    });
    expect(typeof inline.pipeline).toBe('object');
  });

  it('잘못된 값 거부', () => {
    const base = { name: 'qa', displayName: 'QA', command: '/qa', pipeline: './pipeline.yaml' };
    const bad = [
      { name: 'Design QA' },
      { command: 'qa' },
      { command: '/QA' },
      { displayName: '' },
      { pipeline: '/etc/pipeline.yaml' },
      { pipeline: '../other/pipeline.yaml' },
      { pipeline: 'pipeline.txt' },
      { pipeline: { name: 'p', nodes: [] } },
      { defaultEngine: 'Bad Engine' },
      { extra: true },
    ];
    for (const b of bad)
      expect(AgentSchema.safeParse({ ...base, ...b }).success, JSON.stringify(b)).toBe(false);
    const { command: _c, ...noCommand } = base;
    expect(AgentSchema.safeParse(noCommand).success).toBe(false);
  });
});
