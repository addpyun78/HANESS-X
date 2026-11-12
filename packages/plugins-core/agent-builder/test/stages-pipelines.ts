import { pipeline } from './runner-helpers.js';

/** 단독 에이전트 (노드 1개) */
export const SOLO = pipeline({ name: 'solo', nodes: [{ id: 'work', type: 'role', engine: 'fake' }] });

/** 3단계: plan → build → test */
export const THREE = pipeline({
  name: 'three',
  nodes: [
    { id: 'plan', type: 'role', engine: 'fake', outputSchema: { type: 'object', required: ['screens'] } },
    { id: 'build', type: 'role', engine: 'fake', artifacts: ['src/**'] },
    { id: 'test', type: 'role', engine: 'fake', artifacts: ['test/**'] },
  ],
  edges: [
    { from: 'plan', to: 'build' },
    { from: 'build', to: 'test' },
  ],
});

/** plan → build → critic(gate, 실패 시 build로) */
export const TRIO = pipeline({
  name: 'trio',
  nodes: [
    { id: 'plan', type: 'role', engine: 'fake' },
    { id: 'build', type: 'role', engine: 'fake' },
    { id: 'critic', type: 'gate', maxRetries: 2 },
  ],
  edges: [
    { from: 'plan', to: 'build' },
    { from: 'build', to: 'critic' },
    { from: 'critic', to: 'build', onFail: true },
  ],
});

/** plan → build → doc → critic(gate, 실패 시 build로) — 되돌림 뒤 다시 확인 */
export const QUAD = pipeline({
  name: 'quad',
  nodes: [
    { id: 'plan', type: 'role', engine: 'fake' },
    { id: 'build', type: 'role', engine: 'fake' },
    { id: 'doc', type: 'role', engine: 'fake' },
    { id: 'critic', type: 'gate', maxRetries: 2 },
  ],
  edges: [
    { from: 'plan', to: 'build' },
    { from: 'build', to: 'doc' },
    { from: 'doc', to: 'critic' },
    { from: 'critic', to: 'build', onFail: true },
  ],
});

/** 병렬 2갈래 + join */
export const FAN = pipeline({
  name: 'fan',
  nodes: [
    { id: 'split', type: 'fanout' },
    { id: 'web', type: 'role', engine: 'fake' },
    { id: 'mobile', type: 'role', engine: 'fake' },
    { id: 'merge', type: 'join' },
    { id: 'ship', type: 'role', engine: 'fake' },
  ],
  edges: [
    { from: 'split', to: 'web' },
    { from: 'split', to: 'mobile' },
    { from: 'web', to: 'merge' },
    { from: 'mobile', to: 'merge' },
    { from: 'merge', to: 'ship' },
  ],
});

/** 반복 (최대 n회, ok가 참이면 끝) */
export const LOOP = (max = 3) =>
  pipeline({
    name: 'polish',
    entry: 'again',
    nodes: [
      { id: 'again', type: 'loop', maxIterations: max, until: 'output.ok == true', stallLimit: 5 },
      { id: 'fix', type: 'role', engine: 'fake' },
      { id: 'wrap', type: 'role', engine: 'fake' },
    ],
    edges: [
      { from: 'again', to: 'fix' },
      { from: 'fix', to: 'again' },
      { from: 'again', to: 'wrap' },
    ],
  });

/** 분기: look → pick → (big | small) → end */
export const ROUTE = pipeline({
  name: 'route',
  nodes: [
    { id: 'look', type: 'role', engine: 'fake' },
    { id: 'pick', type: 'router', default: 'small' },
    { id: 'big', type: 'role', engine: 'fake' },
    { id: 'small', type: 'role', engine: 'fake' },
    { id: 'end', type: 'role', engine: 'fake' },
  ],
  edges: [
    { from: 'look', to: 'pick' },
    { from: 'pick', to: 'big', when: "output.size == 'big'" },
    { from: 'pick', to: 'small' },
    { from: 'big', to: 'end' },
    { from: 'small', to: 'end' },
  ],
});

/** 하위 에이전트 */
export const MINI = pipeline({
  name: 'mini',
  nodes: [
    { id: 'draft', type: 'role', engine: 'fake' },
    { id: 'polish', type: 'role', engine: 'fake' },
  ],
  edges: [{ from: 'draft', to: 'polish' }],
});

export const PARENT = pipeline({
  name: 'parent',
  nodes: [
    { id: 'prep', type: 'role', engine: 'fake' },
    { id: 'helper', type: 'subagent', agent: 'mini' },
    { id: 'finish', type: 'role', engine: 'fake' },
  ],
  edges: [
    { from: 'prep', to: 'helper' },
    { from: 'helper', to: 'finish' },
  ],
});
