import { z } from 'zod';

/**
 * 플러그인 매니페스트 (harness-plugin.json)
 * 하네스의 모든 기능(엔진·도구·스킬·훅·판정기·파이프라인·패널·메모리·명령)은 슬롯에 꽂히는 플러그인이다.
 */

// ── 3.1 슬롯 ──────────────────────────────────────────────────
export const PLUGIN_SLOTS = [
  'engine',
  'tool',
  'skill',
  'hook',
  'verifier',
  'pipeline',
  'panel',
  'memory',
  'command',
  // T-100 P1-B.4: 기대값·실제값 비교기 (kind 이름 목록)
  'comparator',
] as const;
export const PluginSlotSchema = z.enum(PLUGIN_SLOTS);
export type PluginSlot = z.infer<typeof PluginSlotSchema>;

// ── 3.3 권한 ──────────────────────────────────────────────────
/** 파일 권한: 워크스페이스 안으로만 한정 */
export const FsPermissionSchema = z.enum(['workspace:read', 'workspace:write']);
export type FsPermission = z.infer<typeof FsPermissionSchema>;

/** 도메인 (예: api.example.com, *.example.com). 스킴·경로·포트·공백 금지 */
const DOMAIN_RE = /^(\*\.)?(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
export const NetDomainSchema = z
  .string()
  .regex(DOMAIN_RE, { message: '도메인은 host 형식이어야 합니다 (예: api.example.com, *.example.com)' });

export const PermissionsSchema = z
  .object({
    fs: z.array(FsPermissionSchema).default([]),
    net: z.array(NetDomainSchema).default([]),
    shell: z.boolean().default(false),
  })
  .strict();
export type Permissions = z.infer<typeof PermissionsSchema>;

// ── 3.2 매니페스트 ───────────────────────────────────────────
const PLUGIN_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** 현재 하네스 플러그인 API 버전 */
export const PLUGIN_API_VERSION = 1;

/** 슬롯별 제공 항목: 이름 배열. command는 /이름 형태 */
export const ProvidesSchema = z
  .object({
    engine: z.array(z.string().min(1)).optional(),
    tool: z.array(z.string().min(1)).optional(),
    skill: z.array(z.string().min(1)).optional(),
    hook: z.array(z.string().min(1)).optional(),
    verifier: z.array(z.string().min(1)).optional(),
    pipeline: z.array(z.string().min(1)).optional(),
    panel: z.array(z.string().min(1)).optional(),
    memory: z.array(z.string().min(1)).optional(),
    command: z.array(z.string().regex(/^\/[a-z0-9][a-z0-9-]*$/)).optional(),
    comparator: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/)).optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => Array.isArray(v) && v.length > 0), {
    message: 'provides에 최소 1개 슬롯 항목이 필요합니다',
  });
export type Provides = z.infer<typeof ProvidesSchema>;

export const PluginManifestSchema = z
  .object({
    id: z.string().regex(PLUGIN_ID_RE, { message: 'id는 소문자 kebab-case (점 구분 허용)' }),
    version: z.string().regex(SEMVER_RE, { message: 'version은 semver' }),
    apiVersion: z.number().int().positive(),
    displayName: z.string().min(1).optional(),
    description: z.string().optional(),
    /** 진입 모듈 (매니페스트 기준 상대 경로) */
    main: z.string().min(1).default('index.js'),
    provides: ProvidesSchema,
    /** 의존 플러그인: id → semver 범위 */
    requires: z.record(z.string().regex(PLUGIN_ID_RE), z.string().min(1)).default({}),
    permissions: PermissionsSchema.default({ fs: [], net: [], shell: false }),
    /** 사용자 설정용 JSON Schema */
    configSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginManifestInput = z.input<typeof PluginManifestSchema>;

export function parsePluginManifest(value: unknown): PluginManifest {
  return PluginManifestSchema.parse(value);
}

/** 매니페스트가 제공하는 슬롯 목록 */
export function providedSlots(m: Pick<PluginManifest, 'provides'>): PluginSlot[] {
  return PLUGIN_SLOTS.filter((s) => (m.provides[s]?.length ?? 0) > 0);
}
