import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/** P2-A.2 설치 종류 */
export const INSTALL_KINDS = [
  'winget',
  'scoop',
  'choco',
  'npm-cli',
  'python-cli',
  'cargo',
  'go',
  'ollama-model',
  'mcp-local',
  'mcp-remote',
  'harness-plugin',
  'skill',
  'vscode-ext',
  'docker-image',
  'wsl-apt',
  'direct-download',
  'api-service',
] as const;
export const InstallKindSchema = z.enum(INSTALL_KINDS);
export type InstallKind = z.infer<typeof InstallKindSchema>;

/** 무료/유료 등급 (모르면 unknown) */
export const PRICING_TIERS = ['free', 'freemium', 'paid', 'trial', 'unknown'] as const;
export const PricingTierSchema = z.enum(PRICING_TIERS);
export type PricingTier = z.infer<typeof PricingTierSchema>;

/** 명령을 실행할 곳: Windows(WSL에서는 cmd.exe /c 경유) / 리눅스(WSL 안) */
export const CommandHostSchema = z.enum(['windows', 'linux']);
export type CommandHost = z.infer<typeof CommandHostSchema>;

/** 계획의 작업 종류 (사람 클릭 토큰 종류와 같다) */
export const PlanActionSchema = z.enum(['install', 'uninstall', 'update', 'rollback']);
export type PlanAction = z.infer<typeof PlanActionSchema>;

export const PricingSchema = z.object({
  tier: PricingTierSchema,
  note: z.string(),
  /** 확인 시각 (ISO). 확인 못 했으면 빈 문자열 */
  checkedAt: z.string(),
  sourceUrl: z.string(),
});
export type Pricing = z.infer<typeof PricingSchema>;

export const LicenseSchema = z.object({
  /** SPDX id (모르면 'unknown') */
  id: z.string(),
  /** 쉬운 말 설명 */
  plain: z.string(),
});
export type License = z.infer<typeof LicenseSchema>;

export const SourceSchema = z.object({
  url: z.string(),
  publisher: z.string(),
  verified: z.boolean(),
});

/**
 * P2-A.3 설치 계획.
 * A.3 필드: id, kind, name, version, source, pricing, license, sizeMB, etaSec, needsAdmin, needsRestart,
 *          changes[](쉬운 말), risks[](쉬운 말), commands[](원문), uninstall{commands[]}, verify{cmd, expect}
 * 실행 보조 필드: target(패키지 식별자), host(명령 실행 위치), action(설치/제거/업데이트/정리), interactive
 * (하네스가 대신 실행하지 않고 사용자가 직접 진행하는 단계: sudo 비밀번호·설치 화면)
 */
export const InstallPlanSchema = z
  .object({
    id: z.string().min(1),
    kind: InstallKindSchema,
    name: z.string().min(1),
    version: z.string(),
    source: SourceSchema,
    pricing: PricingSchema,
    license: LicenseSchema,
    sizeMB: z.number().nonnegative().nullable(),
    etaSec: z.number().nonnegative().nullable(),
    needsAdmin: z.boolean(),
    needsRestart: z.boolean(),
    changes: z.array(z.string().min(1)),
    risks: z.array(z.string().min(1)),
    commands: z.array(z.string().min(1)),
    uninstall: z.object({ commands: z.array(z.string().min(1)) }),
    verify: z.object({ cmd: z.string(), expect: z.string() }),
    target: z.string().min(1),
    host: CommandHostSchema.default('windows'),
    action: PlanActionSchema.default('install'),
    interactive: z.boolean().default(false),
    /** 제거·업데이트 계획이 가리키는 도구 목록 id */
    toolId: z.string().optional(),
  })
  .strict();
export type InstallPlan = z.infer<typeof InstallPlanSchema>;
export type InstallPlanInput = z.input<typeof InstallPlanSchema>;

export function newPlanId(): string {
  return `plan_${randomUUID()}`;
}

export const UNKNOWN_PRICING: Pricing = {
  tier: 'unknown',
  note: '무료인지 확인하지 못했어요.',
  checkedAt: '',
  sourceUrl: '',
};

export const UNKNOWN_LICENSE: License = { id: 'unknown', plain: '사용 조건을 확인하지 못했어요.' };

/**
 * P2-D.5 라이선스 쉬운 설명 사전.
 * 순서대로 맞춰 보고 처음 맞는 설명을 쓴다. 없으면 "직접 확인" 안내 (추정으로 무료라고 하지 않는다).
 */
export const LICENSE_FREE_PLAIN = '누구나 무료로 쓸 수 있어요.';
export const LICENSE_COPYLEFT_PLAIN = '무료지만 고쳐서 배포하면 소스 공개 의무가 있어요.';
export const LICENSE_COMMERCIAL_PLAIN = '회사 약관을 따라야 해요.';
export const LICENSE_OTHER_PLAIN = '사용 조건을 직접 확인해 주세요.';

export const LICENSE_DICTIONARY: readonly { match: RegExp; plain: string; examples: string[] }[] = [
  {
    match:
      /^(MIT|MIT-0|Apache-2\.0|BSD-[23]-Clause|ISC|0BSD|Unlicense|MPL-2\.0|Zlib|CC0-1\.0|BSL-1\.0|PSF-2\.0|Python-2\.0)$/i,
    plain: LICENSE_FREE_PLAIN,
    examples: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'MPL-2.0'],
  },
  {
    match: /^(L?GPL|AGPL)/i,
    plain: LICENSE_COPYLEFT_PLAIN,
    examples: ['GPL-3.0', 'GPL-2.0-only', 'LGPL-2.1', 'AGPL-3.0'],
  },
  {
    match: /^(proprietary|commercial|freeware|eula|closed)/i,
    plain: LICENSE_COMMERCIAL_PLAIN,
    examples: ['Proprietary', 'Commercial', 'Freeware'],
  },
];

/** 라이선스 id → 쉬운 말 (D.5 사전) */
export function plainLicense(id: string | undefined | null): License {
  if (!id || !id.trim() || id.trim().toLowerCase() === 'unknown') return UNKNOWN_LICENSE;
  const k = id.trim();
  const hit = LICENSE_DICTIONARY.find((e) => e.match.test(k));
  return { id: k, plain: hit ? hit.plain : LICENSE_OTHER_PLAIN };
}

/** 계획 하나를 만들 때 기본값을 채운다 (어댑터 공용) */
export function makePlan(
  p: Omit<InstallPlanInput, 'id' | 'pricing' | 'license' | 'sizeMB' | 'etaSec' | 'needsRestart'> &
    Partial<Pick<InstallPlanInput, 'id' | 'pricing' | 'license' | 'sizeMB' | 'etaSec' | 'needsRestart'>>,
): InstallPlan {
  return InstallPlanSchema.parse({
    id: newPlanId(),
    pricing: UNKNOWN_PRICING,
    license: UNKNOWN_LICENSE,
    sizeMB: null,
    etaSec: null,
    needsRestart: false,
    ...p,
  });
}

/** 원문 명령 → argv (큰따옴표 묶음 지원, 셸 해석 없음) */
export function parseCommand(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let has = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      has = true;
    } else if (!quoted && /\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else cur += ch;
  }
  if (quoted) throw new Error(`따옴표가 닫히지 않은 명령: ${line}`);
  if (has || cur) out.push(cur);
  return out;
}

/** argv → 원문 (공백·따옴표가 있으면 큰따옴표로 묶음) */
export function formatCommand(argv: readonly string[]): string {
  return argv.map((a) => (a === '' || /[\s"]/.test(a) ? `"${a.replace(/"/g, '')}"` : a)).join(' ');
}
