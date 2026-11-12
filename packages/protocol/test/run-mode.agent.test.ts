import { describe, expect, it } from 'vitest';
import { AgentSchema, parseAgentYaml, stringifyAgent } from '../src/agent.js';
import { parsePipelineYaml } from '../src/pipeline.js';

// T-101 3E.2 agent.yaml defaultMode + 노드별 실행 모드(runMode — role 노드의 mode는 인증 방식이라 겹치지 않게)

const AGENT = `
name: design-qa
displayName: 디자인 QA
command: /design-qa
defaultEngine: claude-code
defaultMode: auto
pipeline: ./pipeline.yaml
`;

const PIPELINE = `
name: design-qa
nodes:
  - id: build
    type: role
    mode: subscription
    runMode: auto
  - id: check
    type: gate
    verifiers: [lint]
    runMode: plan
  - id: report
    type: role
edges:
  - { from: build, to: check }
  - { from: check, to: report }
  - { from: check, to: build, onFail: true }
`;

describe('3E.2 스키마', () => {
  it('agent.yaml defaultMode', () => {
    const a = parseAgentYaml(AGENT);
    expect(a.defaultMode).toBe('auto');
    expect(parseAgentYaml(stringifyAgent(a))).toEqual(a);
    const b = AgentSchema.parse({ name: 'qa', displayName: 'QA', command: '/qa', pipeline: './p.yaml' });
    expect(b.defaultMode).toBeUndefined();
  });

  it('모르는 모드는 거부', () => {
    expect(() => parseAgentYaml(AGENT.replace('defaultMode: auto', 'defaultMode: yolo'))).toThrow();
    expect(() => parsePipelineYaml(PIPELINE.replace('runMode: plan', 'runMode: turbo'))).toThrow();
  });

  it('노드별 runMode (검사 노드는 plan), 인증 mode와 함께 쓸 수 있다', () => {
    const p = parsePipelineYaml(PIPELINE);
    const by = Object.fromEntries(p.nodes.map((n) => [n.id, n]));
    expect(by.check!.runMode).toBe('plan');
    expect(by.build!.runMode).toBe('auto');
    expect(by.build!.type === 'role' && by.build!.mode).toBe('subscription');
    expect(by.report!.runMode).toBeUndefined();
  });
});
