import { describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import { AgentDraftSchema } from '@harness-x/protocol';
import { Designer } from '../src/designer/designer.js';
import { checkDraftEngines } from '../src/designer/engines.js';
import { designerInventory, replayAsk, sampleDraft } from './designer-helpers.js';

describe('P4-C.7 엔진 사용 가능 검사', () => {
  it('로그인 안 된 엔진 지정 → 대체 엔진 제안 + 쉬운 말 이유', () => {
    const d = sampleDraft();
    d.nodes[0]!.engine = 'gemini';
    const s = checkDraftEngines(AgentDraftSchema.parse(d), designerInventory());
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ nodeId: 'plan', engine: 'gemini', health: 'needs-login', suggest: 'codex' });
    expect(s[0]!.message).toContain('로그인이 필요해서');
    expect(checkPlainKorean(s[0]!.message).ok).toBe(true);
  });

  it('꺼진 엔진도 제안, 쓸 수 있는 엔진이 하나도 없으면 그렇다고 알린다', () => {
    const inv = designerInventory();
    inv.engines = inv.engines.map((e) => ({ ...e, health: e.id === 'codex' ? 'disabled' : 'needs-login' }));
    const s = checkDraftEngines(AgentDraftSchema.parse(sampleDraft()), inv);
    expect(s.map((x) => x.suggest)).toEqual([undefined, undefined, undefined]);
    expect(s[1]!.message).toContain('꺼져 있어서');
    for (const x of s) expect(checkPlainKorean(x.message).ok, x.message).toBe(true);
  });

  it('설계 결과에 제안이 실린다 (초안 엔진은 사용자가 고르기 전까지 그대로)', async () => {
    const d = sampleDraft();
    d.nodes[0]!.engine = 'gemini';
    const res = await new Designer({ ask: replayAsk([d]).ask, inventory: () => designerInventory() }).design(
      '계획 세우기',
      { skipQuestions: true },
    );
    if (res.kind !== 'draft') throw new Error(res.kind);
    expect(res.draft.nodes[0]!.engine).toBe('gemini');
    expect(res.engineSuggestions[0]).toMatchObject({ nodeId: 'plan', suggest: 'codex' });
  });
});
