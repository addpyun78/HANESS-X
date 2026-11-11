import { z } from 'zod';

/**
 * 체크리스트 항목 스키마 (20.1)
 * 항목은 경로가 아니라 산출물 ID(artifactId)를 참조한다. 정식 경로는 manifest.json이 확정한다.
 */

export const ITEM_STATUSES = ['todo', 'doing', 'verifying', 'done', 'failed', 'blocked'] as const;
export const ItemStatusSchema = z.enum(ITEM_STATUSES);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

/** 항목 ID: 소문자·숫자·점·하이픈 (예: "1", "1.2", "mobile-login") */
export const ItemIdSchema = z.string().regex(/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$/, {
  message: '항목 id는 영숫자와 . _ - 만 허용',
});

/** 산출물 ID (예: art.mobile-app) */
export const ArtifactIdSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/, {
  message: 'artifactId는 소문자 kebab-case (점 구분 허용, 예: art.mobile-app)',
});

// ── acceptance (기계 검증 조건) ─────────────────────────────────
/**
 * 비교 방식 (T-100 D.1) — 기대값과 실제값을 어떤 비교기로 볼지.
 *  kind: 비교기 종류 (exact·path·text·json·number·version·regex·exitCode 또는 플러그인 비교기, `auto` = 기대값으로 추론)
 *  options: 비교기 옵션 (예: text {mode:'contains'}, json {ignoreKeys}, number {tolerance})
 *  semantic: auto(기본) | off — off면 정규화·사전으로 같다고 못 할 때 의미 판단·승인 카드 없이 즉시 실패
 */
export const COMPARE_SEMANTIC_MODES = ['auto', 'off'] as const;
export const CompareSpecSchema = z
  .object({
    kind: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9-]*$/, { message: '비교기 종류는 영문으로 시작 (예: text, exitCode)' }),
    options: z.record(z.string(), z.unknown()).optional(),
    semantic: z.enum(COMPARE_SEMANTIC_MODES).optional(),
  })
  .strict();
export type CompareSpec = z.infer<typeof CompareSpecSchema>;

/** 명령 실행 후 종료코드 비교. run 안의 {path}는 산출물 경로로 치환된다 */
export const CommandAcceptanceSchema = z.object({
  type: z.literal('command'),
  run: z.string().min(1),
  expectExit: z.number().int().default(0),
  timeoutMs: z.number().int().positive().optional(),
  /** 기대 출력 (있으면 compare로 명령 출력과 비교) */
  expectOutput: z.string().optional(),
  compare: CompareSpecSchema.optional(),
});
/** 테스트 명령 (예: pnpm test mobile). 판정은 command와 같고 종류만 구분 */
export const TestAcceptanceSchema = z.object({
  type: z.literal('test'),
  run: z.string().min(1),
  expectExit: z.number().int().default(0),
  timeoutMs: z.number().int().positive().optional(),
  /** 기대 출력 (있으면 compare로 명령 출력과 비교) */
  expectOutput: z.string().optional(),
  compare: CompareSpecSchema.optional(),
});
/** 산출물(또는 그 안의 file)이 존재 */
export const FileExistsAcceptanceSchema = z.object({
  type: z.literal('file_exists'),
  /** 산출물 경로 기준 상대 경로 (없으면 산출물 자체) */
  file: z.string().min(1).optional(),
  compare: CompareSpecSchema.optional(),
});
/** 산출물(또는 그 안의 file) 텍스트에 심볼이 존재 */
export const SymbolAcceptanceSchema = z.object({
  type: z.literal('symbol'),
  symbol: z.string().min(1),
  file: z.string().min(1).optional(),
  compare: CompareSpecSchema.optional(),
});
/** JSON 파일이 파싱되고 필수 키를 가진다 */
export const SchemaAcceptanceSchema = z.object({
  type: z.literal('schema'),
  file: z.string().min(1).optional(),
  requiredKeys: z.array(z.string().min(1)).default([]),
  compare: CompareSpecSchema.optional(),
});
/** LLM 판단 (기계 검증 아님 — 단독으로는 원자성 린터 R3 위반) */
export const LlmAcceptanceSchema = z.object({
  type: z.literal('llm'),
  prompt: z.string().min(1),
});

export const AcceptanceSchema = z.discriminatedUnion('type', [
  CommandAcceptanceSchema,
  TestAcceptanceSchema,
  FileExistsAcceptanceSchema,
  SymbolAcceptanceSchema,
  SchemaAcceptanceSchema,
  LlmAcceptanceSchema,
]);
export type Acceptance = z.infer<typeof AcceptanceSchema>;
export type AcceptanceInput = z.input<typeof AcceptanceSchema>;
export type AcceptanceType = Acceptance['type'];
export const MACHINE_ACCEPTANCE_TYPES = ['command', 'test', 'file_exists', 'symbol', 'schema'] as const;

// ── evidence / verdict ─────────────────────────────────────────
/** 증거 1건. kind별 추가 필드는 자유(예: ladder 판정, path_corrected, 명령 출력 요약) */
export const EvidenceSchema = z.looseObject({
  kind: z.string().min(1),
  ts: z.iso.datetime({ offset: true }).optional(),
  summary: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * 비교 증거 (T-100 F.1) — 비교기·의미 판단 결과를 evidence에 남긴다.
 *  compare.level: normalize(자동 정리) | dictionary(사전) | semantic(AI 판단) | human(사용자 승인)
 */
export const COMPARE_EVIDENCE_LEVELS = ['normalize', 'dictionary', 'semantic', 'human'] as const;
export const CompareEvidenceSchema = z.looseObject({
  kind: z.literal('compare'),
  ts: z.iso.datetime({ offset: true }).optional(),
  summary: z.string().optional(),
  compare: z
    .object({
      kind: z.string().min(1),
      level: z.enum(COMPARE_EVIDENCE_LEVELS),
      verdict: z.enum(['equal', 'different', 'uncertain']),
      confidence: z.number().min(0).max(1),
      /** 의미 판단 엔진 id (semantic 단계에서만) */
      judgeEngine: z.string().min(1).optional(),
      /** 의미 판단 반복 횟수 */
      samples: z.number().int().positive().optional(),
      normalizedExpected: z.string(),
      normalizedActual: z.string(),
    })
    .strict(),
  /** 의미 판단(AI)으로 통과한 비교 (F.2) */
  ai_judged: z.boolean().optional(),
});
export type CompareEvidence = z.infer<typeof CompareEvidenceSchema>;

/** evidence가 비교 증거면 파싱 결과, 아니면 undefined */
export function compareEvidenceOf(e: Evidence): CompareEvidence | undefined {
  if (e.kind !== 'compare') return undefined;
  const r = CompareEvidenceSchema.safeParse(e);
  return r.success ? r.data : undefined;
}

export const VERDICTS = ['equal', 'relocated', 'wrong', 'missing'] as const;
export const VerdictKindSchema = z.enum(VERDICTS);
export type VerdictKind = z.infer<typeof VerdictKindSchema>;

/** 판정 사다리 결과 (L1~L5) */
export const VerdictSchema = z.object({
  level: z.number().int().min(1).max(5),
  verdict: VerdictKindSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

/** 원자성 린터 R4용 예상 크기 */
export const EstimateSchema = z.object({
  files: z.number().int().nonnegative().optional(),
  diffLines: z.number().int().nonnegative().optional(),
});
export type Estimate = z.infer<typeof EstimateSchema>;

// ── 항목 ──────────────────────────────────────────────────────
export const ChecklistItemSchema = z
  .object({
    id: ItemIdSchema,
    parent: ItemIdSchema.nullable().default(null),
    title: z.string().trim().min(1),
    /** 담당 엔진/에이전트 ID (미정이면 null) */
    owner: z.string().min(1).nullable().default(null),
    deps: z.array(ItemIdSchema).default([]),
    artifactId: ArtifactIdSchema,
    acceptance: z.array(AcceptanceSchema).min(1),
    status: ItemStatusSchema.default('todo'),
    attempts: z.number().int().nonnegative().default(0),
    evidence: z.array(EvidenceSchema).default([]),
    verdict: VerdictSchema.optional(),
    estimate: EstimateSchema.optional(),
  })
  .strict()
  .refine((i) => i.parent !== i.id, {
    message: '항목은 자기 자신을 parent로 둘 수 없습니다',
    path: ['parent'],
  })
  .refine((i) => !i.deps.includes(i.id), {
    message: '항목은 자기 자신에 의존할 수 없습니다',
    path: ['deps'],
  });
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type ChecklistItemInput = z.input<typeof ChecklistItemSchema>;

// ── 체크리스트 문서 (checklist.json) ─────────────────────────────
export const CHECKLIST_SCHEMA_VERSION = 1;

export const ChecklistSchema = z
  .object({
    schemaVersion: z.literal(CHECKLIST_SCHEMA_VERSION),
    /** 개정 번호(v1, v2 …). 개정 시 이전 개정본을 checklist.v{n}.json으로 보관 */
    revision: z.number().int().positive(),
    /** 쓰기마다 1씩 증가하는 낙관적 잠금 버전 */
    version: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime({ offset: true }),
    items: z.array(ChecklistItemSchema),
  })
  .strict()
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    for (const [k, it] of c.items.entries()) {
      if (ids.has(it.id))
        ctx.addIssue({ code: 'custom', message: `중복 항목 id: ${it.id}`, path: ['items', k] });
      ids.add(it.id);
    }
    for (const [k, it] of c.items.entries()) {
      if (it.parent !== null && !ids.has(it.parent))
        ctx.addIssue({ code: 'custom', message: `없는 parent: ${it.parent}`, path: ['items', k, 'parent'] });
      for (const d of it.deps)
        if (!ids.has(d))
          ctx.addIssue({ code: 'custom', message: `없는 dep: ${d}`, path: ['items', k, 'deps'] });
    }
  });
export type Checklist = z.infer<typeof ChecklistSchema>;

export function parseItem(value: unknown): ChecklistItem {
  return ChecklistItemSchema.parse(value);
}

export function parseChecklist(value: unknown): Checklist {
  return ChecklistSchema.parse(value);
}
