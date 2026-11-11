import { StageDepthError, attachAgentTree, buildSkeleton, getStage } from '@harness-x/checklist-ledger';
import { describe, expect, it } from 'vitest';
import { pipeline } from './runner-helpers.js';
import { MINI, PARENT } from './stages-pipelines.js';
import { runWithStages, statuses } from './stages-run.js';

describe('4E.4 하위 에이전트: 그 에이전트 트리를 해당 단계 아래에 중첩 (깊이 최대 3)', () => {
  it('뼈대에는 하위 단계가 없고, 부르는 순간 그 아래에 들어간다', async () => {
    const t = buildSkeleton({ sessionId: 's', agent: { name: 'parent', pipeline: PARENT } });
    expect(getStage(t, 'helper').children).toEqual([]);
    const { r, tree } = await runWithStages({
      pipeline: PARENT,
      resolveAgent: (n) => (n === 'mini' ? MINI : undefined),
    });
    expect(r.status).toBe('completed');
    expect(statuses(tree)).toEqual({
      prep: 'done',
      helper: 'done',
      'helper.draft': 'done',
      'helper.polish': 'done',
      finish: 'done',
    });
    expect(getStage(tree, 'helper').agent).toBe('mini');
  });

  it('깊이 3까지 허용, 4번째는 거부', () => {
    const sub = (name: string, inner: string) =>
      pipeline({ name, nodes: [{ id: 'call', type: 'subagent', agent: inner }] });
    let t = buildSkeleton({ sessionId: 's', agent: { name: 'a', pipeline: sub('a', 'b') } });
    t = attachAgentTree(t, 'call', { name: 'b', pipeline: sub('b', 'c') }); // 깊이 2
    t = attachAgentTree(t, 'call.call', { name: 'c', pipeline: sub('c', 'd') }); // 깊이 3
    expect(getStage(t, 'call.call.call').kind).toBe('subagent');
    expect(() => attachAgentTree(t, 'call.call.call', { name: 'd', pipeline: MINI })).toThrow(
      StageDepthError,
    );
  });
});
