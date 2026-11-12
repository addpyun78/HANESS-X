import { z } from 'zod';
import { AcceptanceSchema, ChecklistItemSchema, type ChecklistItem } from '../schema.js';

/**
 * 단계 트리 (T-101 4A.2)
 * 세션 체크리스트(루트) → 단계 항목 → 하위 항목(기존 항목 스키마 그대로).
 * 단계는 오직 에이전트 파일(파이프라인)에 적힌 것만 쓴다. 에이전트가 없으면 단계 1개("작업").
 */

export const STAGE_STATUSES = [
  'expected',
  'planning',
  'locked',
  'running',
  'verifying',
  'done',
  'reopened',
  'needs-recheck',
  'skipped',
  'blocked',
] as const;
export const StageStatusSchema = z.enum(STAGE_STATUSES);
export type StageStatus = z.infer<typeof StageStatusSchema>;

/** task = 에이전트 없는 단계 1개, loop = 반복 묶음, iteration = 반복 회차 */
export const STAGE_KINDS = ['task', 'role', 'gate', 'join', 'subagent', 'loop', 'iteration'] as const;
export const StageKindSchema = z.enum(STAGE_KINDS);
export type StageKind = z.infer<typeof StageKindSchema>;

/** 단계 id: 노드 id를 점으로 이은 경로 (예: build, review.2.fix, sub.plan) */
export const StageIdSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/, {
  message: '단계 id는 소문자 kebab-case를 점으로 이은 것',
});

/** 단계 출구 조건: 출력 스키마(T-042) + 노드 acceptance */
export const ExitCriteriaSchema = z
  .object({
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    acceptance: z.array(AcceptanceSchema).default([]),
  })
  .strict();
export type ExitCriteria = z.infer<typeof ExitCriteriaSchema>;

/** 하위 항목의 출처 (4B.2·4D.1) */
export const ItemOriginSchema = z.enum(['template', 'proposed', 'rework', 'ledger']);
export const StageItemMetaSchema = z
  .object({
    origin: ItemOriginSchema,
    /** 재작업 번호 (r1, r2 …) */
    rework: z.number().int().positive().optional(),
    /** 재작업이 다시 하는 원래 항목 */
    reworkOf: z.string().min(1).optional(),
    /** 지적한 검사 단계 */
    gateStageId: z.string().min(1).optional(),
    /** 지적 원문 */
    note: z.string().optional(),
    /** 지적 원문 링크 (이벤트 id 등) */
    link: z.string().optional(),
  })
  .strict();
export type StageItemMeta = z.infer<typeof StageItemMetaSchema>;

/** 단계 완료 시 다음 단계로 넘기는 값 (4C.1) */
export const HandoffSchema = z
  .object({
    output: z.unknown(),
    /** 쉬운 말 3줄 이내 */
    summary: z.string(),
    at: z.iso.datetime({ offset: true }),
  })
  .strict();
export type Handoff = z.infer<typeof HandoffSchema>;

/** 단계 산출물 범위 (4B.4) */
export const StageScopeSchema = z
  .object({
    /** 이 단계가 쓸 수 있는 경로 패턴 */
    artifacts: z.array(z.string().min(1)).default([]),
    /** 산출물을 고쳐도 되는 다른 노드 id */
    canModify: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type StageScope = z.infer<typeof StageScopeSchema>;

export interface Stage {
  stageId: string;
  nodeId: string | null;
  title: string;
  kind: StageKind;
  status: StageStatus;
  exitCriteria: ExitCriteria;
  summary?: string | undefined;
  iteration?: number | undefined;
  items: ChecklistItem[];
  itemMeta: Record<string, StageItemMeta>;
  handoff?: Handoff | undefined;
  /** 병렬 갈래 (fanout 노드 id) */
  fanout?: string | undefined;
  /** join이 기다리는 단계 */
  waitFor: string[];
  /** 분기 갈래 (router 노드 id + 갈래 첫 노드) */
  route?: { router: string; to: string; when?: string | undefined } | undefined;
  /** 건너뜀·막힘 이유 */
  reason?: string | undefined;
  scope: StageScope;
  /** 검사 단계: 실패 횟수 */
  failures: number;
  /** 반복 묶음: 최대 회차 */
  maxIterations?: number | undefined;
  /** 하위 에이전트 이름 */
  agent?: string | undefined;
  engineId?: string | undefined;
  /** 반복 회차·하위 에이전트 트리 */
  children: Stage[];
}

export const StageSchema: z.ZodType<Stage, z.input<z.ZodTypeAny>> = z.lazy(() =>
  z
    .object({
      stageId: StageIdSchema,
      nodeId: z.string().min(1).nullable(),
      title: z.string().trim().min(1),
      kind: StageKindSchema,
      status: StageStatusSchema.default('expected'),
      exitCriteria: ExitCriteriaSchema.default({ acceptance: [] }),
      summary: z.string().optional(),
      iteration: z.number().int().positive().optional(),
      items: z.array(ChecklistItemSchema).default([]),
      itemMeta: z.record(z.string(), StageItemMetaSchema).default({}),
      handoff: HandoffSchema.optional(),
      fanout: z.string().min(1).optional(),
      waitFor: z.array(StageIdSchema).default([]),
      route: z
        .object({ router: z.string().min(1), to: z.string().min(1), when: z.string().optional() })
        .strict()
        .optional(),
      reason: z.string().optional(),
      scope: StageScopeSchema.default({ artifacts: [], canModify: [] }),
      failures: z.number().int().nonnegative().default(0),
      maxIterations: z.number().int().positive().optional(),
      agent: z.string().min(1).optional(),
      engineId: z.string().min(1).optional(),
      children: z.array(StageSchema).default([]),
    })
    .strict()
    .superRefine((s, ctx) => {
      const ids = new Set<string>();
      for (const [k, it] of s.items.entries()) {
        if (ids.has(it.id))
          ctx.addIssue({ code: 'custom', message: `중복 항목 id: ${it.id}`, path: ['items', k] });
        ids.add(it.id);
      }
      for (const id of Object.keys(s.itemMeta))
        if (!ids.has(id))
          ctx.addIssue({ code: 'custom', message: `없는 항목의 메타: ${id}`, path: ['itemMeta'] });
    }),
) as never;

export const STAGE_TREE_SCHEMA_VERSION = 1;
/** 하위 에이전트 중첩 최대 깊이 (4E.4) */
export const MAX_STAGE_DEPTH = 3;

export const StageTreeSchema = z
  .object({
    schemaVersion: z.literal(STAGE_TREE_SCHEMA_VERSION),
    sessionId: z.string().min(1),
    /** 실행한 에이전트 이름 (없으면 null = 단계 1개) */
    agent: z.string().min(1).nullable(),
    pipeline: z.string().min(1).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    stages: z.array(StageSchema).min(1),
  })
  .strict()
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    const walk = (list: readonly Stage[], depth: number) => {
      for (const s of list) {
        if (seen.has(s.stageId)) ctx.addIssue({ code: 'custom', message: `중복 단계 id: ${s.stageId}` });
        seen.add(s.stageId);
        walk(s.children, s.kind === 'subagent' ? depth + 1 : depth);
      }
      if (list.length && depth > MAX_STAGE_DEPTH)
        ctx.addIssue({ code: 'custom', message: `하위 에이전트 중첩은 ${MAX_STAGE_DEPTH}단계까지` });
    };
    walk(t.stages, 1);
  });
export type StageTree = z.infer<typeof StageTreeSchema>;
export type StageInput = z.input<typeof StageSchema>;

export function parseStageTree(v: unknown): StageTree {
  return StageTreeSchema.parse(v);
}
