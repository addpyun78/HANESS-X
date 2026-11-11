import { InstallKindSchema, PricingTierSchema, TRUST_LEVEL_NAMES } from '@harness-x/installer';
import { z } from 'zod';

/**
 * P3-B.4 후보 정규화 `ToolCandidate`
 * { name, summary, pricing{tier, note, sourceUrl, checkedAt}, license, officialUrl, installMethods[], os[],
 *   maintenance{lastRelease, archived}, trust, pros, cons }
 * + id(병합 열쇠), sources(찾아 준 공급자)
 * B.5: 모든 pricing에 sourceUrl·checkedAt 필수 (빈 문자열 금지)
 */

export const CANDIDATE_OS = ['windows', 'linux', 'mac'] as const;
export const CandidateOsSchema = z.enum(CANDIDATE_OS);
export type CandidateOs = z.infer<typeof CandidateOsSchema>;

export const CandidatePricingSchema = z
  .object({
    tier: PricingTierSchema,
    note: z.string(),
    sourceUrl: z.string().url(),
    checkedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type CandidatePricing = z.infer<typeof CandidatePricingSchema>;

export const InstallMethodSchema = z
  .object({
    kind: InstallKindSchema,
    /** 설치 관리자 target.id (winget id, npm 이름, ollama 모델 …) */
    id: z.string().min(1),
    /** 쉬운 말 (예: "Windows 공식 앱 저장소") */
    label: z.string().min(1),
  })
  .strict();
export type InstallMethod = z.infer<typeof InstallMethodSchema>;

export const CandidateTrustSchema = z
  .object({ level: z.enum(TRUST_LEVEL_NAMES), reasons: z.array(z.string()) })
  .strict();

export const ToolCandidateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    summary: z.string(),
    pricing: CandidatePricingSchema,
    /** SPDX id, 모르면 'unknown' */
    license: z.string().min(1),
    officialUrl: z.string(),
    installMethods: z.array(InstallMethodSchema),
    os: z.array(CandidateOsSchema),
    maintenance: z.object({ lastRelease: z.string().nullable(), archived: z.boolean() }).strict(),
    trust: CandidateTrustSchema,
    pros: z.array(z.string()),
    cons: z.array(z.string()),
    sources: z.array(z.string()).default([]),
  })
  .strict();
export type ToolCandidate = z.infer<typeof ToolCandidateSchema>;
export type ToolCandidateInput = z.input<typeof ToolCandidateSchema>;

export function parseCandidate(v: unknown): ToolCandidate {
  return ToolCandidateSchema.parse(v);
}

/** 화면용 덧붙임(이유·배지 등)을 뺀 후보 정보만 (형식이 틀리면 ZodError) */
export function pureCandidate(v: object): ToolCandidate {
  const keys = ToolCandidateSchema.keyof().options;
  const o = v as Record<string, unknown>;
  return ToolCandidateSchema.parse(Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]])));
}

/** 이름 → 병합 열쇠 */
export function candidateKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(exe|app)$/, '')
    .replace(/[^a-z0-9가-힣]+/g, '');
}
