import { describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import { AgentDraftSchema } from '@harness-x/protocol';
import { Designer } from '../src/designer/designer.js';
import { applyJsonPatch, checkPatchedDraft, parsePatchReply } from '../src/designer/patch.js';
import { designerInventory, replayAsk, sampleDraft } from './designer-helpers.js';

const draft = () => AgentDraftSchema.parse(sampleDraft());
const toClaude = { patch: [{ op: 'replace', path: '/nodes/2/engine', value: 'claude-code' }] };

describe('P4-E.2 말로 고치기 → 설계 AI는 변경 패치(JSON Patch)만 돌려준다', () => {
  it('패치 형식: {"patch":[{op,path,value}]} — add/replace/remove, 허용 경로만', () => {
    expect(parsePatchReply(JSON.stringify(toClaude))).toEqual({ ok: true, patch: toClaude.patch });
    const bad = [
      JSON.stringify(sampleDraft()), // 초안 전체를 돌려주면 거부
      JSON.stringify({ patch: [] }),
      JSON.stringify({ patch: [{ op: 'move', from: '/a', path: '/nodes/0' }] }),
      JSON.stringify({ patch: [{ op: 'replace', path: '/save', value: true }] }),
      JSON.stringify({ patch: [{ op: 'replace', path: 'nodes/0/engine', value: 'x' }] }),
      JSON.stringify({ patch: [{ op: 'add', path: '/nodes/-' }] }),
      '패치 없음',
    ];
    for (const b of bad) expect(parsePatchReply(b).ok, b).toBe(false);
  });

  it('JSON Patch 적용: replace·add(-, 배열 중간)·remove, 원본은 그대로', () => {
    const d = draft();
    const next = applyJsonPatch(d, [
      { op: 'replace', path: '/nodes/2/engine', value: 'claude-code' },
      { op: 'add', path: '/nodes/1/skills/-', value: 'compose-ui' },
      { op: 'add', path: '/nodes/0/skills/0', value: 'ui-audit' },
      { op: 'remove', path: '/gaps/0' },
    ]);
    expect(next.nodes[2]!.engine).toBe('claude-code');
    expect(next.nodes[1]!.skills).toEqual(['kotlin-compose', 'ui-tokens', 'compose-ui']);
    expect(next.nodes[0]!.skills).toEqual(['ui-audit', 'plan-writer']);
    expect(next.gaps).toEqual([]);
    expect(d.nodes[2]!.engine).toBe('antigravity');
    expect(() => applyJsonPatch(d, [{ op: 'remove', path: '/nodes/9' }])).toThrow();
  });

  it('"검사는 claude로 바꿔줘" → 패치만 요청하고 미리보기 초안 + 바뀐 점(쉬운 말)', async () => {
    const r = replayAsk([toClaude]);
    const d = new Designer({ ask: r.ask, inventory: () => designerInventory() });
    const res = await d.edit(draft(), '검사는 claude로 바꿔줘');
    expect(r.prompts[0]!.user).toContain('Reply with ONLY a JSON Patch');
    expect(r.prompts[0]!.user).toContain('검사는 claude로 바꿔줘');
    if (!res.ok) throw new Error(res.message);
    expect(res.patch).toEqual(toClaude.patch);
    expect(res.draft.nodes[2]!.engine).toBe('claude-code');
    expect(res.changes.map((c) => c.message)).toEqual([
      '"검사 담당"를 맡는 AI가 "antigravity"에서 "claude-code"로 바뀌어요.',
    ]);
    for (const c of res.changes) expect(checkPlainKorean(c.message).ok, c.message).toBe(true);
  });
});

describe('P4-E.3 패치 검증: C.6~C.8 검사를 다시, 실패 시 적용 안 함 + 쉬운 말 사유', () => {
  const inv = designerInventory();
  const reject = (patch: object[]) => {
    const r = checkPatchedDraft(draft(), patch as Parameters<typeof checkPatchedDraft>[1], inv);
    expect(r.ok).toBe(false);
    if (r.ok) return [];
    for (const m of r.reasons) expect(checkPlainKorean(m).ok, m).toBe(true);
    return r.reasons;
  };

  it('C.6 목록에 없는 id', () => {
    expect(reject([{ op: 'add', path: '/nodes/0/skills/-', value: 'screenshot-diff' }])[0]).toContain(
      '"screenshot-diff"',
    );
    expect(reject([{ op: 'replace', path: '/nodes/2/engine', value: 'gpt-9' }])[0]).toContain('"gpt-9"');
  });

  it('C.7 로그인 안 된 엔진', () => {
    expect(reject([{ op: 'replace', path: '/nodes/2/engine', value: 'gemini' }])[0]).toContain(
      '로그인이 필요해서',
    );
  });

  it('C.8 순환이 생기는 연결', () => {
    expect(reject([{ op: 'add', path: '/edges/-', value: { from: 'critic', to: 'plan' } }])[0]).toContain(
      '되돌아가는 연결',
    );
  });

  it('형식 위반·없는 경로·어려운 말', () => {
    expect(reject([{ op: 'remove', path: '/nodes/0/reason' }])).toEqual([
      '바꾼 결과가 초안 형식에 맞지 않아요.',
    ]);
    expect(reject([{ op: 'remove', path: '/nodes/7' }])).toEqual(['바꿀 곳을 초안에서 찾지 못했어요.']);
    expect(
      reject([{ op: 'replace', path: '/nodes/0/reason', value: 'JSON schema regex parse' }])[0],
    ).toContain('어려운 말');
  });

  it('Designer.edit: 거부되면 미리보기 없이 사유만', async () => {
    const r = replayAsk([{ patch: [{ op: 'replace', path: '/nodes/2/engine', value: 'gemini' }] }]);
    const res = await new Designer({ ask: r.ask, inventory: () => inv }).edit(draft(), '검사는 gemini로');
    expect(res).toMatchObject({ ok: false, message: '이 변경은 적용하지 않았어요.' });
  });
});
