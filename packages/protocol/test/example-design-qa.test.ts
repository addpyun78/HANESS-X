import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAgentYaml } from '../src/agent.js';
import { parsePipelineYaml, pipelineEntry } from '../src/pipeline.js';

const dir = fileURLToPath(new URL('../../../examples/agents/design-qa/', import.meta.url));

describe('40.5 예제 design-qa', () => {
  it('agent.yaml·pipeline.yaml 스키마 통과, plan → build → critic', () => {
    const agent = parseAgentYaml(readFileSync(dir + 'agent.yaml', 'utf8'));
    expect(agent.command).toBe('/design-qa');
    expect(agent.pipeline).toBe('./pipeline.yaml');
    const p = parsePipelineYaml(readFileSync(dir + 'pipeline.yaml', 'utf8'));
    expect(p.nodes.map((n) => n.id)).toEqual(['plan', 'build', 'critic']);
    expect(pipelineEntry(p)).toBe('plan');
    expect(p.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['plan>build', 'build>critic']);
    // 노드마다 다른 엔진
    expect(p.nodes.map((n) => (n.type === 'role' ? n.engine : ''))).toEqual([
      'claude-code',
      'codex',
      'antigravity',
    ]);
  });
});
