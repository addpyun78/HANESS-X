import { describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import { AgentDraftSchema, type AgentDraftInput } from '@harness-x/protocol';
import { checkStructure, findCycleEdge } from '../src/designer/structure.js';
import { sampleDraft } from './designer-helpers.js';

const parse = (d: AgentDraftInput) => AgentDraftSchema.parse(d);
const obj = (props: Record<string, string>, required = Object.keys(props)) => ({
  type: 'object',
  properties: Object.fromEntries(Object.entries(props).map(([k, t]) => [k, { type: t }])),
  required,
});

describe('P4-C.8 구조 검사: 위반 초안 3종 자동 교정 또는 경고', () => {
  it('① 순환(loop 노드 없이) → 되돌아가는 연결을 빼서 교정', () => {
    const d = parse(
      sampleDraft({
        edges: [
          { from: 'plan', to: 'build' },
          { from: 'build', to: 'critic' },
          { from: 'critic', to: 'plan' },
        ],
      }),
    );
    expect(findCycleEdge(d)).toBeDefined();
    const r = checkStructure(d);
    expect(findCycleEdge(r.draft)).toBeUndefined();
    expect(r.draft.edges).toHaveLength(2);
    expect(r.notices.find((n) => n.code === 'cycle-removed')?.fixed).toBe(true);
  });

  it('loop 노드를 지나는 순환은 그대로 둔다', () => {
    const base = sampleDraft();
    const d = parse({
      ...base,
      nodes: [...base.nodes, { id: 'again', kind: 'loop', role: '반복', reason: '다시 해요.' }],
      edges: [
        { from: 'again', to: 'build' },
        { from: 'build', to: 'critic' },
        { from: 'critic', to: 'again' },
        { from: 'plan', to: 'again' },
      ],
    });
    expect(checkStructure(d).notices.filter((n) => n.code === 'cycle-removed')).toEqual([]);
  });

  it('② 스키마 비호환(T-042 정적 검사) → 경고', () => {
    const base = sampleDraft();
    base.nodes[1]!.outputSchema = obj({ files: 'array' });
    base.nodes[2]!.inputSchema = obj({ report: 'string' });
    const r = checkStructure(parse(base));
    const w = r.notices.find((n) => n.code === 'schema-mismatch');
    expect(w).toMatchObject({ nodeId: 'critic', fixed: false });
  });

  it('③ 권한 최소화: 쓰기 담당이 아니면 읽기 전용, 쓰기 담당 full → 프로젝트 폴더 안', () => {
    const base = sampleDraft();
    base.nodes[0]!.permission = 'workspace-write';
    base.nodes[2]!.permission = 'full';
    base.nodes[1]!.permission = 'full';
    const r = checkStructure(parse(base));
    expect(r.draft.nodes.map((n) => n.permission)).toEqual(['read-only', 'workspace-write', 'read-only']);
    expect(r.notices.filter((n) => n.code === 'permission-reduced')).toHaveLength(3);
  });

  it('모든 안내는 쉬운 말', () => {
    const base = sampleDraft({
      edges: [
        { from: 'plan', to: 'build' },
        { from: 'build', to: 'critic' },
        { from: 'critic', to: 'plan' },
      ],
    });
    base.nodes[0]!.permission = 'full';
    base.nodes[1]!.outputSchema = obj({ files: 'array' });
    base.nodes[2]!.inputSchema = obj({ report: 'string' });
    for (const n of checkStructure(parse(base)).notices)
      expect(checkPlainKorean(n.message).ok, n.message).toBe(true);
  });
});
