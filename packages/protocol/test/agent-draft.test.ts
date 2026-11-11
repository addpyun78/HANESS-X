import { describe, expect, it } from 'vitest';
import {
  AgentDraftSchema,
  DraftQuestionsSchema,
  draftAssetRefs,
  draftToPipeline,
  PipelineSchema,
  type AgentDraftInput,
} from '../src/index.js';

const draft = (): AgentDraftInput => ({
  name: 'design-review',
  displayName: '화면 디자인 검수',
  command: '/design-review',
  summary: '화면을 살펴봐요.\n고칠 곳을 고쳐요.\n다른 AI가 검사해요.',
  nodes: [
    {
      id: 'plan',
      kind: 'role',
      role: '계획 담당',
      duty: 'plan',
      engine: 'claude-code',
      skills: ['plan-writer'],
      reason: '계획을 세워요.',
    },
    {
      id: 'build',
      kind: 'role',
      role: '고치기 담당',
      duty: 'write',
      engine: 'codex',
      permission: 'workspace-write',
      reason: '고쳐요.',
    },
  ],
  edges: [{ from: 'plan', to: 'build' }],
  gaps: [{ id: 'gap-1', need: '스크린샷 두 장을 비교하는 기능', nodeId: 'build' }],
  estimatedCostHint: '10분 정도 걸려요.',
});

describe('P4-C.4 AgentDraft 엄격 JSON 스키마', () => {
  it('정상 초안 통과 + 기본값(duty·permission·skills·gaps)', () => {
    const d = AgentDraftSchema.parse(draft());
    expect(d.nodes[1]!.skills).toEqual([]);
    expect(d.nodes[0]!.permission).toBe('read-only');
    expect(d.gaps[0]).toMatchObject({ kind: 'other', origin: 'designer' });
  });

  it('필수 필드: name·displayName·command·summary·nodes·estimatedCostHint, 노드 reason', () => {
    for (const k of ['name', 'displayName', 'command', 'summary', 'nodes', 'estimatedCostHint'] as const) {
      const d = draft() as Record<string, unknown>;
      delete d[k];
      expect(AgentDraftSchema.safeParse(d).success, k).toBe(false);
    }
    const d = draft();
    delete (d.nodes[0] as { reason?: string }).reason;
    expect(AgentDraftSchema.safeParse(d).success).toBe(false);
  });

  it('엄격: 모르는 키·잘못된 command·summary 3~5줄 아님·없는 노드 엣지·중복 id 거부', () => {
    const bad: AgentDraftInput[] = [
      { ...draft(), extra: 1 } as AgentDraftInput,
      { ...draft(), command: 'design-review' },
      { ...draft(), summary: '한 줄이에요.' },
      { ...draft(), summary: 'a\nb\nc\nd\ne\nf' },
      { ...draft(), edges: [{ from: 'plan', to: 'ghost' }] },
      { ...draft(), nodes: [draft().nodes[0]!, draft().nodes[0]!] },
      { ...draft(), gaps: [{ id: 'g', need: 'x', nodeId: 'ghost' }] },
      { ...draft(), nodes: [{ ...draft().nodes[0]!, kind: 'robot' as 'role' }] },
    ];
    for (const b of bad) expect(AgentDraftSchema.safeParse(b).success).toBe(false);
  });

  it('질문 응답 형식: 질문마다 선택지 2~5개', () => {
    expect(
      DraftQuestionsSchema.safeParse({
        questions: [{ id: 'q1', text: '어떤 화면인가요?', choices: ['목록', '상세'] }],
      }).success,
    ).toBe(true);
    expect(
      DraftQuestionsSchema.safeParse({ questions: [{ id: 'q1', text: '?', choices: ['하나'] }] }).success,
    ).toBe(false);
  });

  it('초안 → pipeline.yaml 객체 (파이프라인 스키마 통과) · 자산 id 모음', () => {
    const d = AgentDraftSchema.parse(draft());
    expect(PipelineSchema.safeParse(draftToPipeline(d)).success).toBe(true);
    expect(draftAssetRefs(d)).toEqual([
      { kind: 'skill', id: 'plan-writer', nodeId: 'plan' },
      { kind: 'engine', id: 'claude-code', nodeId: 'plan' },
      { kind: 'engine', id: 'codex', nodeId: 'build' },
    ]);
  });
});
