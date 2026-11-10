import { describe, expect, it } from 'vitest';
import { parsePipeline } from '@harness-x/protocol';
import { applyModifiers, parseModifiers } from '../src/dispatch.js';

const P = parsePipeline({
  name: 'qa',
  nodes: [
    { id: 'plan', type: 'role', engine: 'claude-code' },
    { id: 'build', type: 'role', engine: 'codex' },
    { id: 'sub', type: 'subagent', agent: 'other', engine: 'codex' },
    { id: 'sub2', type: 'subagent', agent: 'other' },
  ],
  edges: [
    { from: 'plan', to: 'build' },
    { from: 'build', to: 'sub' },
    { from: 'sub', to: 'sub2' },
  ],
});

describe('48.2 수식어 파서: @엔진 #strict !plan', () => {
  it('수식어를 뽑고 지시문에서 뺀다', () => {
    expect(parseModifiers('@codex 로그인 화면 고쳐 줘 #strict')).toEqual({
      prompt: '로그인 화면 고쳐 줘',
      modifiers: { engine: 'codex', strict: true, planOnly: false },
      tokens: ['@codex', '#strict'],
    });
    expect(parseModifiers('!plan 결제 흐름 설계').modifiers).toEqual({ strict: false, planOnly: true });
    expect(parseModifiers('!plan 결제 흐름 설계').prompt).toBe('결제 흐름 설계');
  });

  it('수식어가 없으면 그대로, 대소문자 무시, 마지막 @엔진이 이긴다', () => {
    expect(parseModifiers('그냥 지시')).toEqual({
      prompt: '그냥 지시',
      modifiers: { strict: false, planOnly: false },
      tokens: [],
    });
    expect(parseModifiers('#STRICT @Claude-Code a @codex').modifiers).toEqual({
      engine: 'codex',
      strict: true,
      planOnly: false,
    });
  });

  it('낱말 중간의 @·#·!는 수식어가 아니다 (메일·해시태그·느낌표 문장)', () => {
    const r = parseModifiers('a@b.com 에 보내 #strictly 멋져!plan 안녕! @ 혼자');
    expect(r.tokens).toEqual([]);
    expect(r.prompt).toBe('a@b.com 에 보내 #strictly 멋져!plan 안녕! @ 혼자');
  });

  it('여러 줄 지시문의 줄바꿈은 남긴다', () => {
    expect(parseModifiers('첫 줄 @codex\n둘째 줄 !plan').prompt).toBe('첫 줄\n둘째 줄');
  });

  it('applyModifiers @엔진: role 전부 + 엔진을 지정한 subagent만 교체, 원본 불변', () => {
    const p = applyModifiers(P, { engine: 'antigravity' });
    expect(p.nodes.map((n) => ('engine' in n ? n.engine : undefined))).toEqual([
      'antigravity',
      'antigravity',
      'antigravity',
      undefined,
    ]);
    expect(P.nodes[0]).toMatchObject({ engine: 'claude-code' });
  });

  it('applyModifiers !plan: 시작 노드 하나만 읽기 전용으로', () => {
    const p = applyModifiers(P, { planOnly: true });
    expect(p.nodes).toHaveLength(1);
    expect(p.nodes[0]).toMatchObject({ id: 'plan', permission: 'read-only' });
    expect(p.edges).toEqual([]);
    expect(p.entry).toBe('plan');
    expect(applyModifiers(P, { strict: true })).toEqual(P);
  });
});
