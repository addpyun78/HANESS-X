import { advanceStage, buildSkeleton, completeStage, markItemsDone, type StageTree } from '../src/index.js';
import { FIXED_NOW, P, templates } from './stages-helpers.js';

/** plan → build → doc → critic(gate, onFail → build) */
export const QUAD = P({
  name: 'quad',
  nodes: [
    { id: 'plan', type: 'role' },
    { id: 'build', type: 'role' },
    { id: 'doc', type: 'role', outputSchema: { type: 'object', required: ['pages'] } },
    { id: 'critic', type: 'gate' },
  ],
  edges: [
    { from: 'plan', to: 'build' },
    { from: 'build', to: 'doc' },
    { from: 'doc', to: 'critic' },
    { from: 'critic', to: 'build', onFail: true },
  ],
});

export function finish(t: StageTree, id: string, output: unknown = {}): StageTree {
  const x = markItemsDone(advanceStage(t, id, 'running', FIXED_NOW), id);
  const r = completeStage(x, id, { handoff: { output, summary: `${id} 끝` }, now: FIXED_NOW });
  if (!r.done) throw new Error(r.reason);
  return r.tree;
}

export function atCritic(): StageTree {
  let t = buildSkeleton({
    sessionId: 's',
    agent: { name: 'quad', pipeline: QUAD },
    templates,
    now: FIXED_NOW,
  });
  t = finish(t, 'plan');
  t = finish(t, 'build');
  t = finish(t, 'doc', { pages: 2 });
  return advanceStage(t, 'critic', 'running');
}

export const finding = {
  stageId: 'build',
  itemId: 'build2',
  reason: '버튼 글자 대비가 낮아요',
  link: 'event:ev-42',
};
