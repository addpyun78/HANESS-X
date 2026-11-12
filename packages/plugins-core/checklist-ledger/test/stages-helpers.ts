import { parsePipeline, type PipelineInput, type PipelineNode } from '@harness-x/protocol';
import type { ChecklistItemInput } from '../src/index.js';

export const FIXED_NOW = () => new Date('2026-11-12T00:00:00.000Z');

export const item = (id: string, o: Partial<ChecklistItemInput> = {}): ChecklistItemInput => ({
  id,
  title: `${id} 화면 만들기`,
  artifactId: 'art.app',
  acceptance: [{ type: 'command', run: 'true' }],
  ...o,
});

/** 노드마다 틀 항목 2개 (id = <노드>1, <노드>2) */
export const templates = (n: PipelineNode): ChecklistItemInput[] | undefined =>
  n.type === 'role' || n.type === 'gate'
    ? [
        item(`${n.id}1`, { title: `${n.id} 틀 항목 1 쓰기` }),
        item(`${n.id}2`, { title: `${n.id} 틀 항목 2 쓰기` }),
      ]
    : undefined;

export const P = (p: PipelineInput) => parsePipeline(p);

/** plan → build → critic(gate, onFail → build) */
export const TRIO = P({
  name: 'trio',
  nodes: [
    { id: 'plan', type: 'role' },
    { id: 'build', type: 'role', artifacts: ['src/**'] },
    { id: 'critic', type: 'gate' },
  ],
  edges: [
    { from: 'plan', to: 'build' },
    { from: 'build', to: 'critic' },
    { from: 'critic', to: 'build', onFail: true },
  ],
});

/** 3단계 plain (plan → build → test) */
export const THREE = P({
  name: 'three',
  nodes: [
    { id: 'plan', type: 'role', outputSchema: { type: 'object', required: ['screens'] } },
    { id: 'build', type: 'role', artifacts: ['src/**'], canModify: [] },
    { id: 'test', type: 'role', artifacts: ['test/**'], canModify: ['build'] },
  ],
  edges: [
    { from: 'plan', to: 'build' },
    { from: 'build', to: 'test' },
  ],
});

export const FAN = P({
  name: 'fan',
  nodes: [
    { id: 'split', type: 'fanout' },
    { id: 'web', type: 'role' },
    { id: 'mobile', type: 'role' },
    { id: 'merge', type: 'join' },
    { id: 'ship', type: 'role' },
  ],
  edges: [
    { from: 'split', to: 'web' },
    { from: 'split', to: 'mobile' },
    { from: 'web', to: 'merge' },
    { from: 'mobile', to: 'merge' },
    { from: 'merge', to: 'ship' },
  ],
});

export const LOOP = P({
  name: 'polish',
  entry: 'again',
  nodes: [
    { id: 'again', type: 'loop', maxIterations: 3, until: 'output.ok == true' },
    { id: 'fix', type: 'role' },
    { id: 'done', type: 'role' },
  ],
  edges: [
    { from: 'again', to: 'fix' },
    { from: 'fix', to: 'again' },
    { from: 'again', to: 'done' },
  ],
});

export const ROUTE = P({
  name: 'route',
  nodes: [
    { id: 'look', type: 'role' },
    { id: 'pick', type: 'router', default: 'small' },
    { id: 'big', type: 'role' },
    { id: 'small', type: 'role' },
    { id: 'end', type: 'role' },
  ],
  edges: [
    { from: 'look', to: 'pick' },
    { from: 'pick', to: 'big', when: "output.size == 'big'" },
    { from: 'pick', to: 'small' },
    { from: 'big', to: 'end' },
    { from: 'small', to: 'end' },
  ],
});
