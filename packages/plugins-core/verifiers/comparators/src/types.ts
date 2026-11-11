import { release } from 'node:os';
import type { Glossary, GlossaryIndex } from '@harness-x/checklist-ledger';
import { z } from 'zod';

/**
 * 비교기 공통 타입 (T-100 P1-B)
 * 모든 검증은 비교기를 거친다: 정규화 → 사전 → 의미 판단 → 사용자 승인.
 * 비교기는 앞의 두 칸(정규화·사전)만 코드로 판단하고, 확정하지 못하면 `uncertain`을 돌려
 * 의미 판단(judge) 칸에 넘긴다. 모델 호출 0회, 0원.
 */

// ── B.2 CompareResult ─────────────────────────────────────────
export const COMPARE_VERDICTS = ['equal', 'different', 'uncertain'] as const;
export const CompareVerdictSchema = z.enum(COMPARE_VERDICTS);
export type CompareVerdict = z.infer<typeof CompareVerdictSchema>;

/** 판정이 어느 칸에서 났는가 */
export const COMPARE_LEVELS = ['normalize', 'dictionary', 'semantic', 'human'] as const;
export const CompareLevelSchema = z.enum(COMPARE_LEVELS);
export type CompareLevel = z.infer<typeof CompareLevelSchema>;

/** 차이 위치 표시 (예: JSON 경로 `$.a[2]`, 줄 번호) */
export const CompareDiffSchema = z
  .object({
    /** 차이가 난 위치 (JSON 경로·줄 번호·경로 조각 등) */
    at: z.string(),
    expected: z.unknown().optional(),
    actual: z.unknown().optional(),
  })
  .strict();
export type CompareDiff = z.infer<typeof CompareDiffSchema>;

export const CompareResultSchema = z
  .object({
    verdict: CompareVerdictSchema,
    level: CompareLevelSchema,
    /** 0~1 */
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
    diff: CompareDiffSchema.optional(),
  })
  .strict();
export type CompareResult = z.infer<typeof CompareResultSchema>;

// ── B.3 CompareCtx ────────────────────────────────────────────
export const COMPARE_OS = ['win', 'wsl', 'posix'] as const;
export type CompareOs = (typeof COMPARE_OS)[number];

/** 사전에 등록된 동치 쌍 (F.3이 equivalences.json으로 저장) */
export interface EquivalencePair {
  /** 비교기 종류 (`*` = 모든 종류) */
  kind: string;
  a: string;
  b: string;
}

/** 사전 허용 규칙 — 기본은 모두 꺼짐 */
export const EQUIVALENCE_RULES = ['path.dash-underscore'] as const;
export type EquivalenceRule = (typeof EQUIVALENCE_RULES)[number];

export interface Equivalences {
  pairs: readonly EquivalencePair[];
  rules: readonly EquivalenceRule[];
}

export const EquivalencesSchema = z
  .object({
    version: z.literal(1).default(1),
    pairs: z.array(z.object({ kind: z.string().min(1), a: z.string(), b: z.string() }).strict()).default([]),
    rules: z.array(z.enum(EQUIVALENCE_RULES)).default([]),
  })
  .strict();

export const EMPTY_EQUIVALENCES: Equivalences = Object.freeze({ pairs: [], rules: [] });

export interface CompareCtx {
  os: CompareOs;
  /** 작업 폴더 루트 (상대 경로 기준) */
  workspaceRoot: string;
  /** 경로·이름 별칭 사전 (판정 사다리 L2와 같은 glossary) */
  glossary: Glossary | GlossaryIndex;
  /** 텍스트 표현 동치 사전 */
  equivalences: Equivalences;
  /** 항목 제목 (의미 판단에 넘기는 메타데이터) */
  itemTitle: string;
  sessionId: string;
}

/** 현재 실행 환경의 os 종류 (WSL은 커널 이름에 microsoft가 들어 있다) */
export function detectCompareOs(
  platform: string = process.platform,
  kernelRelease: string = release(),
): CompareOs {
  if (platform === 'win32') return 'win';
  if (platform === 'linux' && /microsoft/i.test(kernelRelease)) return 'wsl';
  return 'posix';
}

/** 빈 사전·현재 os로 만든 기본 ctx (판정 사다리 밖 호출용) */
export function defaultCompareCtx(extra: Partial<CompareCtx> = {}): CompareCtx {
  return {
    os: detectCompareOs(),
    workspaceRoot: '',
    glossary: { version: 1, terms: [] },
    equivalences: EMPTY_EQUIVALENCES,
    itemTitle: '',
    sessionId: '',
    ...extra,
  };
}

// ── B.1 Comparator ────────────────────────────────────────────
/** 비교기 옵션 (종류별로 다르다) */
export type CompareOptions = Record<string, unknown>;

export interface Comparator<O extends CompareOptions = CompareOptions> {
  /** 비교기 종류 (acceptance compare.kind) */
  readonly kind: string;
  /** 비교용 정규화 — 증거(normalizedExpected/Actual)에 그대로 남긴다 */
  normalize(value: unknown, ctx: CompareCtx, options?: O): string;
  /** a = 기대값, b = 실제값 */
  equals(a: unknown, b: unknown, ctx: CompareCtx, options?: O): CompareResult;
}

/** 결과 생성 도우미 */
export function result(
  verdict: CompareVerdict,
  level: CompareLevel,
  reason: string,
  extra: { confidence?: number; diff?: CompareDiff } = {},
): CompareResult {
  return {
    verdict,
    level,
    confidence: extra.confidence ?? (verdict === 'uncertain' ? 0 : 1),
    reason,
    ...(extra.diff ? { diff: extra.diff } : {}),
  };
}

/** 값 → 문자열 (문자열은 그대로, 그 밖은 JSON) */
export function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v) ?? String(v);
}

/** 사전 쌍 확인: 정규화된 기대값·실제값이 등록된 쌍이면 true */
export function inDictionary(
  kind: string,
  a: string,
  b: string,
  ctx: CompareCtx,
  norm: (s: string) => string = (s) => s,
): boolean {
  return ctx.equivalences.pairs.some((p) => {
    if (p.kind !== kind && p.kind !== '*') return false;
    const pa = norm(p.a);
    const pb = norm(p.b);
    return (pa === a && pb === b) || (pa === b && pb === a);
  });
}
