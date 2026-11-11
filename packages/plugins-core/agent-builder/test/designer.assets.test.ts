import { describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import { AgentDraftSchema } from '@harness-x/protocol';
import { findUnknownRefs } from '../src/designer/assets.js';
import { Designer } from '../src/designer/designer.js';
import { designerInventory, replayAsk, sampleDraft } from './designer-helpers.js';

const req = '임장노트 화면 디자인 검수 에이전트 만들어 줘';
const withFake = () => {
  const d = sampleDraft();
  d.nodes[2]!.skills = ['ui-audit', 'screenshot-diff'];
  d.nodes[1]!.tools = ['figma-export'];
  return d;
};

describe('P4-C.6 지어낸 자산 차단', () => {
  it('인벤토리에 없는 skill·tool·engine·agent id를 찾는다', () => {
    const d = AgentDraftSchema.parse({
      ...withFake(),
      nodes: [
        ...withFake().nodes,
        {
          id: 'sub',
          kind: 'subagent',
          role: '부르기',
          agent: 'ghost-agent',
          engine: 'gpt-9',
          reason: '불러요.',
        },
      ],
    });
    expect(findUnknownRefs(d, designerInventory()).map((u) => `${u.kind}:${u.id}`)).toEqual([
      'tool:figma-export',
      'skill:screenshot-diff',
      'engine:gpt-9',
      'agent:ghost-agent',
    ]);
  });

  it('가짜 스킬 id 주입 → "목록에 없는 id: …, 목록 안에서만 골라라"로 재요청 → 고치면 그대로 씀', async () => {
    const r = replayAsk([withFake(), sampleDraft()]);
    const res = await new Designer({ ask: r.ask, inventory: () => designerInventory() }).design(req, {
      skipQuestions: true,
    });
    expect(r.prompts[1]!.user).toContain('목록에 없는 id: tool "figma-export", skill "screenshot-diff"');
    expect(r.prompts[1]!.user).toContain('목록 안에서만 골라라');
    expect(res.kind === 'draft' && findUnknownRefs(res.draft, designerInventory())).toEqual([]);
  });

  it('최대 2회 재요청, 그래도 있으면 그 칸을 gaps로 옮긴다 (가짜 id 0개, 자동 생성 없음)', async () => {
    const r = replayAsk([withFake()]);
    const res = await new Designer({ ask: r.ask, inventory: () => designerInventory() }).design(req, {
      skipQuestions: true,
    });
    expect(r.calls()).toBe(3);
    if (res.kind !== 'draft') throw new Error(res.kind);
    expect(findUnknownRefs(res.draft, designerInventory())).toEqual([]);
    expect(res.draft.nodes.find((n) => n.id === 'critic')!.skills).toEqual(['ui-audit']);
    const moved = res.draft.gaps.filter((g) => g.origin === 'unknown-id');
    expect(moved.map((g) => [g.missingId, g.nodeId, g.kind])).toEqual([
      ['figma-export', 'build', 'tool'],
      ['screenshot-diff', 'critic', 'skill'],
    ]);
    for (const g of moved) expect(checkPlainKorean(g.need).ok, g.need).toBe(true);
    expect(res.notices.some((n) => n.source === 'fabrication')).toBe(true);
  });
});
