import { z } from 'zod';
import { PermissionsSchema } from '@harness-x/protocol';
import { TEMPLATE_KINDS } from '@harness-x/sdk';

/**
 * forge-spec.json — Forge가 만들 플러그인의 명세
 * 인터뷰 답 + 요청문 → (엔진이 다듬음) → 사용자 확인 카드 → scaffold/check/test/install이 모두 이것만 본다.
 */

export const FORGE_SPEC_FILE = 'forge-spec.json';

/** 훅 이름 (kernel HOOK_NAMES와 같다) */
export const FORGE_HOOK_NAMES = [
  'session.start',
  'prompt.submit',
  'tool.before',
  'tool.after',
  'turn.end',
  'stop.before',
  'context.compact',
  'item.verify',
] as const;

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** 시험 예시: 이 입력이면 이렇게 되어야 한다 (52.3 acceptance) */
export const ForgeExampleSchema = z
  .object({
    name: z.string().min(1),
    /** 훅 컨텍스트 (훅) 또는 도구 입력 */
    input: z.record(z.string(), z.unknown()).default({}),
    /** 시험용 임시 워크스페이스에 미리 깔 파일: 상대 경로 → 내용 */
    files: z.record(z.string(), z.string()).default({}),
    expect: z
      .object({
        /** 차단형 훅 결정 */
        decision: z.enum(['allow', 'deny', 'block']).optional(),
        /** 결정 사유에 들어 있어야 할 글 */
        reasonContains: z.string().min(1).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type ForgeExample = z.infer<typeof ForgeExampleSchema>;

export const ForgeSpecSchema = z
  .object({
    version: z.literal(1).default(1),
    /** 플러그인 id (kebab-case) — 설치 폴더 이름 */
    id: z.string().regex(ID_RE, { message: 'id는 소문자 kebab-case' }).max(64),
    displayName: z
      .string()
      .min(1)
      .max(80)
      .refine((s) => !/[\r\n]/.test(s) && !s.includes('*/'), { message: 'displayName은 한 줄, */ 금지' }),
    description: z.string().min(1).max(1024),
    /** 종류 = 템플릿 */
    kind: z.enum(TEMPLATE_KINDS),
    /** 처음 요청문 */
    request: z.string().default(''),
    /** 발동 시점 (훅이면 hook 필수) */
    trigger: z
      .object({
        hook: z.enum(FORGE_HOOK_NAMES).optional(),
        /** 발동 조건 (예: 명령에 'gh pr create'가 들어 있을 때) */
        match: z.string().optional(),
        /** 사람이 읽는 설명 */
        when: z.string().optional(),
      })
      .strict()
      .default({}),
    /** 입출력 */
    io: z
      .object({
        input: z.string().min(1),
        output: z.string().min(1),
      })
      .strict(),
    permissions: PermissionsSchema.default({ fs: [], net: [], shell: false }),
    /** 셸을 쓴다면 돌릴 명령 (예: ./gradlew ktlintCheck) */
    command: z.string().optional(),
    /** 수용 기준 (사람이 읽는 문장) */
    acceptance: z.array(z.string().min(1)).default([]),
    /** 성공 예시 (샌드박스 시험 입력) */
    examples: z.array(ForgeExampleSchema).min(1),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.kind === 'hook' && !s.trigger.hook)
      ctx.addIssue({ code: 'custom', path: ['trigger', 'hook'], message: '훅은 trigger.hook이 필요함' });
  });
export type ForgeSpec = z.infer<typeof ForgeSpecSchema>;
export type ForgeSpecInput = z.input<typeof ForgeSpecSchema>;

export interface SpecValidation {
  ok: boolean;
  errors: string[];
  spec?: ForgeSpec;
}

export function validateForgeSpec(value: unknown): SpecValidation {
  const r = ForgeSpecSchema.safeParse(value);
  if (r.success) return { ok: true, errors: [], spec: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

export function parseForgeSpec(value: unknown): ForgeSpec {
  return ForgeSpecSchema.parse(value);
}
