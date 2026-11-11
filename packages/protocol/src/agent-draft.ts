import { z } from 'zod';
import { AgentNameSchema, SlashCommandSchema } from './agent.js';
import {
  AuthModeSchema,
  ConditionSchema,
  JsonSchemaObjectSchema,
  NodeIdSchema,
  NodePermissionSchema,
  NodeTypeSchema,
  type PipelineInput,
  type PipelineNodeInput,
} from './pipeline.js';

/**
 * T-100 P4-C.4 설계 AI 출력 `AgentDraft` (엄격 JSON 스키마)
 * 대화로 만든 에이전트 초안. 캔버스(빌더 그래프)·저장(agent.yaml + pipeline.yaml)으로 바뀐다.
 * - nodes[].reason: AI가 이렇게 정한 이유 (쉬운 말, 인스펙터 P4-D.4)
 * - gaps[]: 인벤토리에 없는 능력 = 빈 칸 (자동으로 만들지 않는다, P4-C.10)
 * 웹(브라우저)과 설계기(agent-builder)가 같이 쓰므로 protocol에 둔다.
 */

/** 노드가 맡은 일 (검사 담당 다른 엔진 규칙 P4-C.9, 권한 린트 P4-C.8에 쓴다) */
export const DRAFT_DUTIES = ['plan', 'write', 'check', 'other'] as const;
export const DraftDutySchema = z.enum(DRAFT_DUTIES);
export type DraftDuty = z.infer<typeof DraftDutySchema>;

export const DraftNodeSchema = z
  .object({
    id: NodeIdSchema,
    /** 노드 종류 (role·gate·fanout·join·loop·router·subagent) */
    kind: NodeTypeSchema,
    /** 역할명 (캔버스 제목, 예: "계획 담당") */
    role: z.string().trim().min(1),
    duty: DraftDutySchema.default('other'),
    engine: z.string().min(1).optional(),
    mode: AuthModeSchema.optional(),
    skills: z.array(z.string().min(1)).default([]),
    tools: z.array(z.string().min(1)).default([]),
    permission: NodePermissionSchema.default('read-only'),
    checklistTemplate: z.string().min(1).optional(),
    inputSchema: JsonSchemaObjectSchema.optional(),
    outputSchema: JsonSchemaObjectSchema.optional(),
    /** subagent 노드가 부르는 기존 에이전트 이름 */
    agent: z.string().min(1).optional(),
    /** gate 노드 판정기 */
    verifiers: z.array(z.string().min(1)).optional(),
    /** 노드 지시문 (선택) */
    prompt: z.string().optional(),
    /** AI가 이렇게 정한 이유 (쉬운 말) */
    reason: z.string().trim().min(1),
  })
  .strict();
export type DraftNode = z.infer<typeof DraftNodeSchema>;
export type DraftNodeInput = z.input<typeof DraftNodeSchema>;

export const DraftEdgeSchema = z
  .object({
    from: NodeIdSchema,
    to: NodeIdSchema,
    when: ConditionSchema.optional(),
    onFail: z.boolean().optional(),
  })
  .strict();
export type DraftEdge = z.infer<typeof DraftEdgeSchema>;

/** 빈 칸이 생긴 이유: 설계 AI가 처음부터 없다고 함 / 목록에 없는 id라 옮김 / 사람이 남김 */
export const GAP_ORIGINS = ['designer', 'unknown-id', 'user'] as const;

export const DraftGapSchema = z
  .object({
    id: z.string().min(1),
    /** 필요한 능력 (쉬운 말, 예: "화면 스크린샷 두 장을 비교하는 기능") */
    need: z.string().trim().min(1),
    /** 이 빈 칸이 붙을 노드 (없으면 따로 떠 있는 칸) */
    nodeId: NodeIdSchema.optional(),
    /** 어떤 종류의 자산이 필요한가 */
    kind: z.enum(['skill', 'tool', 'engine', 'agent', 'other']).default('other'),
    /** 목록에 없어 옮겨진 원래 id (unknown-id) */
    missingId: z.string().optional(),
    origin: z.enum(GAP_ORIGINS).default('designer'),
  })
  .strict();
export type DraftGap = z.infer<typeof DraftGapSchema>;

const summaryLines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;

export const AgentDraftSchema = z
  .object({
    name: AgentNameSchema,
    displayName: z.string().trim().min(1),
    command: SlashCommandSchema,
    /** 쉬운 말 3~5줄 */
    summary: z
      .string()
      .refine((s) => summaryLines(s) >= 3 && summaryLines(s) <= 5, { message: 'summary는 3~5줄' }),
    nodes: z.array(DraftNodeSchema).min(1),
    edges: z.array(DraftEdgeSchema).default([]),
    gaps: z.array(DraftGapSchema).default([]),
    /** 비용 감 (쉬운 말, 예: "구독 범위 안에서 한 번에 10분 정도") */
    estimatedCostHint: z.string().trim().min(1),
  })
  .strict()
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    for (const [i, n] of d.nodes.entries()) {
      if (ids.has(n.id))
        ctx.addIssue({ code: 'custom', message: `노드 id 중복: ${n.id}`, path: ['nodes', i, 'id'] });
      ids.add(n.id);
    }
    for (const [i, e] of d.edges.entries())
      for (const end of [e.from, e.to])
        if (!ids.has(end))
          ctx.addIssue({ code: 'custom', message: `엣지가 없는 노드를 가리킴: ${end}`, path: ['edges', i] });
    for (const [i, g] of d.gaps.entries())
      if (g.nodeId && !ids.has(g.nodeId))
        ctx.addIssue({
          code: 'custom',
          message: `빈 칸이 없는 노드를 가리킴: ${g.nodeId}`,
          path: ['gaps', i],
        });
  });
export type AgentDraft = z.infer<typeof AgentDraftSchema>;
export type AgentDraftInput = z.input<typeof AgentDraftSchema>;

/** 설계 AI가 되물을 때의 응답 (P4-C.3): 질문마다 선택지 버튼 */
export const DraftQuestionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().trim().min(1),
    choices: z.array(z.string().trim().min(1)).min(2).max(5),
  })
  .strict();
export type DraftQuestion = z.infer<typeof DraftQuestionSchema>;

export const DraftQuestionsSchema = z.object({ questions: z.array(DraftQuestionSchema).min(1) }).strict();

/** 초안 노드 → 파이프라인 노드 명세 (빌더 그래프·저장 공용) */
export function draftNodeToSpec(n: DraftNode): PipelineNodeInput {
  const base = { id: n.id, label: n.role };
  switch (n.kind) {
    case 'role':
      return {
        ...base,
        type: 'role',
        ...(n.engine ? { engine: n.engine } : {}),
        ...(n.mode ? { mode: n.mode } : {}),
        skills: [...n.skills],
        tools: [...n.tools],
        permission: n.permission,
        ...(n.checklistTemplate ? { checklistTemplate: n.checklistTemplate } : {}),
        ...(n.prompt ? { prompt: n.prompt } : {}),
        ...(n.inputSchema ? { inputSchema: n.inputSchema } : {}),
        ...(n.outputSchema ? { outputSchema: n.outputSchema } : {}),
      };
    case 'gate':
      return {
        ...base,
        type: 'gate',
        verifiers: [...(n.verifiers ?? [])],
        ...(n.checklistTemplate ? { checklistTemplate: n.checklistTemplate } : {}),
      };
    case 'subagent':
      return {
        ...base,
        type: 'subagent',
        agent: n.agent ?? '',
        ...(n.engine ? { engine: n.engine } : {}),
        ...(n.inputSchema ? { inputSchema: n.inputSchema } : {}),
        ...(n.outputSchema ? { outputSchema: n.outputSchema } : {}),
      };
    default:
      return { ...base, type: n.kind };
  }
}

/** 초안 → pipeline.yaml 객체 */
export function draftToPipeline(d: AgentDraft): PipelineInput {
  return {
    name: d.name,
    displayName: d.displayName,
    nodes: d.nodes.map(draftNodeToSpec),
    edges: d.edges.map((e) => ({
      from: e.from,
      to: e.to,
      ...(e.when ? { when: e.when } : {}),
      ...(e.onFail ? { onFail: true } : {}),
    })),
  };
}

/** 초안이 쓰는 자산 id 모음 (지어낸 자산 검사 P4-C.6) */
export function draftAssetRefs(
  d: AgentDraft,
): { kind: 'skill' | 'tool' | 'engine' | 'agent'; id: string; nodeId: string }[] {
  const out: { kind: 'skill' | 'tool' | 'engine' | 'agent'; id: string; nodeId: string }[] = [];
  for (const n of d.nodes) {
    for (const s of n.skills) out.push({ kind: 'skill', id: s, nodeId: n.id });
    for (const t of n.tools) out.push({ kind: 'tool', id: t, nodeId: n.id });
    if (n.engine && n.engine !== 'auto') out.push({ kind: 'engine', id: n.engine, nodeId: n.id });
    if (n.agent) out.push({ kind: 'agent', id: n.agent, nodeId: n.id });
  }
  return out;
}
