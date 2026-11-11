import { describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import { AgentDraftSchema } from '@harness-x/protocol';
import { assignCriticEngines, userNamedCheckEngine } from '../src/designer/critic.js';
import { designerInventory, sampleDraft } from './designer-helpers.js';

const sameEngine = () => {
  const d = sampleDraft();
  d.nodes[2]!.engine = 'codex'; // 고치기와 같은 엔진
  return AgentDraftSchema.parse(d);
};

describe('P4-C.9 검사 담당은 작성 담당과 다른 엔진', () => {
  it('같은 엔진이면 다른 준비된 엔진으로 바꾼다 + 쉬운 말 안내', () => {
    const r = assignCriticEngines(sameEngine(), designerInventory(), '화면 검수 에이전트 만들어 줘');
    expect(r.draft.nodes[2]!.engine).toBe('claude-code');
    expect(r.notices[0]).toMatchObject({ nodeId: 'critic', kind: 'reassigned' });
    expect(checkPlainKorean(r.notices[0]!.message).ok).toBe(true);
  });

  it('이미 다르면 그대로', () => {
    const r = assignCriticEngines(AgentDraftSchema.parse(sampleDraft()), designerInventory(), '검수');
    expect(r.draft.nodes[2]!.engine).toBe('antigravity');
    expect(r.notices).toEqual([]);
  });

  it('엔진이 1개뿐이면 같은 엔진 + 안내', () => {
    const inv = designerInventory();
    inv.engines = inv.engines.filter((e) => e.id === 'codex');
    const r = assignCriticEngines(sameEngine(), inv, '검수 에이전트');
    expect(r.draft.nodes[2]!.engine).toBe('codex');
    expect(r.notices[0]).toMatchObject({
      kind: 'single-engine',
      message: '쓸 수 있는 AI가 하나뿐이라 같은 AI가 검사해요.',
    });
  });

  it('사용자가 "검사는 codex로" 라고 말했으면 그 엔진을 쓴다', () => {
    const inv = designerInventory();
    expect(userNamedCheckEngine('고치는 건 codex로. 검사는 codex로 해 줘', inv)).toBe('codex');
    const r = assignCriticEngines(sameEngine(), inv, '고치는 건 codex로. 검사는 codex로 해 줘');
    expect(r.draft.nodes[2]!.engine).toBe('codex');
    expect(r.notices[0]!.kind).toBe('user');
  });
});
