import { describe, expect, it } from 'vitest';
import { AgentDraftSchema, draftAssetRefs } from '@harness-x/protocol';
import { findUnknownRefs, inventoryIds } from '../src/designer/assets.js';
import { Designer } from '../src/designer/designer.js';
import { designerInventory, replayAsk, sampleDraft } from './designer-helpers.js';

/**
 * P4-G.2 지어낸 자산 회귀: 설계 AI가 없는 스킬(·도구·엔진·에이전트)을 넣는 상황을 주입해도
 * 최종 초안에는 가짜 id가 0개다 (재요청으로 고치거나, 끝까지 안 고치면 빈 칸으로 옮긴다).
 */
const FAKES = {
  skill: 'screenshot-diff',
  tool: 'figma-export',
  engine: 'gpt-9',
  agent: 'ghost-agent',
};

function poisoned() {
  const d = sampleDraft();
  d.nodes[0]!.skills = [...(d.nodes[0]!.skills ?? []), FAKES.skill, 'pdf-table'];
  d.nodes[1]!.tools = [FAKES.tool];
  d.nodes[2]!.engine = FAKES.engine;
  d.nodes.push({
    id: 'sub',
    kind: 'subagent',
    role: '기존 검수 부르기',
    agent: FAKES.agent,
    reason: '불러요.',
  });
  d.edges = [...(d.edges ?? []), { from: 'critic', to: 'sub' }];
  return d;
}

const allFake = (d: ReturnType<typeof AgentDraftSchema.parse>) => {
  const ids = inventoryIds(designerInventory());
  return draftAssetRefs(d).filter((r) => !ids[r.kind].has(r.id));
};

describe('P4-G.2 지어낸 자산 회귀 — 최종 초안에 가짜 id 0개', () => {
  const cases: [string, (string | object)[]][] = [
    ['끝까지 고치지 않는 설계 AI (3번 모두 가짜)', [poisoned()]],
    ['한 번 고쳤는데 다른 가짜를 넣음', [poisoned(), { ...poisoned(), nodes: poisoned().nodes.slice(0, 2) }]],
    ['재요청 답이 깨짐 → 처음 초안 기준으로 빈 칸', [poisoned(), '죄송해요', '{']],
    ['두 번째에 고침', [poisoned(), sampleDraft()]],
  ];
  for (const [name, replies] of cases)
    it(name, async () => {
      const r = replayAsk(replies);
      const res = await new Designer({ ask: r.ask, inventory: () => designerInventory() }).design(
        '스크린샷 비교하고 피그마에서 가져오는 에이전트 만들어 줘',
        { skipQuestions: true },
      );
      expect(res.kind).toBe('draft');
      if (res.kind !== 'draft') return;
      expect(findUnknownRefs(res.draft, designerInventory())).toEqual([]);
      expect(allFake(res.draft)).toEqual([]);
      const text = JSON.stringify(res.draft.nodes);
      for (const f of [...Object.values(FAKES), 'pdf-table']) expect(text).not.toContain(`"${f}"`);
      expect(r.calls()).toBeLessThanOrEqual(3); // 처음 1 + 재요청 최대 2
    });

  it('빈 칸으로 옮겨진 것은 무엇이 없었는지 남긴다 (자동으로 새로 만들지 않음)', async () => {
    const res = await new Designer({
      ask: replayAsk([poisoned()]).ask,
      inventory: () => designerInventory(),
    }).design('검수', { skipQuestions: true });
    if (res.kind !== 'draft') throw new Error(res.kind);
    expect(
      res.draft.gaps
        .filter((g) => g.origin === 'unknown-id')
        .map((g) => g.missingId)
        .sort(),
    ).toEqual([...Object.values(FAKES), 'pdf-table'].sort());
  });
});
