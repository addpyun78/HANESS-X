import { z } from 'zod';

/**
 * P4-A.1 자산 전수조사(Inventory) 스키마.
 * 설계 AI에게 "하네스에 실제로 있는 것"만 알려 주는 스냅샷이다.
 * 비밀·파일 본문·코드는 절대 들어가지 않는다(P4-A.9 filter.ts).
 */

/** P4-A.8 자산 건강 상태 */
export const ASSET_HEALTH = ['ready', 'needs-login', 'disabled', 'outdated'] as const;
export const AssetHealthSchema = z.enum(ASSET_HEALTH);
export type AssetHealth = z.infer<typeof AssetHealthSchema>;

const Permissions = z
  .object({
    fs: z.array(z.string()),
    net: z.array(z.string()),
    shell: z.boolean(),
  })
  .strict();

export const PluginAssetSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    displayName: z.string().optional(),
    description: z.string().optional(),
    /** 제공 슬롯 (engine·tool·skill …) */
    slots: z.array(z.string()),
    /** 제공 명령 (/이름) */
    commands: z.array(z.string()),
    permissions: Permissions,
    /** 활성 여부 (로더 state === 'active') */
    enabled: z.boolean(),
    origin: z.string().optional(),
    health: AssetHealthSchema,
  })
  .strict();
export type PluginAsset = z.infer<typeof PluginAssetSchema>;

export const SkillAssetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    /** 소속 플러그인 (없으면 사용자 스킬 폴더) */
    pluginId: z.string().optional(),
    /** 설명에서 뽑은 키워드 */
    tags: z.array(z.string()),
    health: AssetHealthSchema,
  })
  .strict();
export type SkillAsset = z.infer<typeof SkillAssetSchema>;

export const ENGINE_LOGIN = ['loggedIn', 'loggedOut', 'unknown'] as const;
export const ENGINE_MODE = ['subscription', 'apiKey', 'unknown'] as const;
export const QUOTA_LEVEL = ['ok', 'warning', 'danger', 'unknown'] as const;

export const EngineAssetSchema = z
  .object({
    /** 하네스 엔진 id (claude-code, codex, antigravity …) */
    id: z.string().min(1),
    /** 탐지된 실행 파일 이름 (claude, agy …) */
    binary: z.string().min(1),
    installed: z.boolean(),
    version: z.string().nullable(),
    /** windows | linux | macos | wsl:<배포판> */
    location: z.string(),
    /** 위치 분류 */
    host: z.enum(['windows', 'wsl', 'other']),
    login: z.enum(ENGINE_LOGIN),
    mode: z.enum(ENGINE_MODE),
    /** 쿼터 여유 (ratio = 사용/한도, 모르면 unknown) */
    quota: z.object({ level: z.enum(QUOTA_LEVEL), ratio: z.number().optional() }).strict(),
    health: AssetHealthSchema,
  })
  .strict();
export type EngineAsset = z.infer<typeof EngineAssetSchema>;

export const PRICING = ['free', 'paid', 'unknown'] as const;

export const ToolAssetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.string(),
    version: z.string().optional(),
    /** 무료/유료 (모르면 unknown) */
    pricing: z.enum(PRICING),
    purpose: z.string(),
    capabilities: z.array(z.string()),
    /** registry = ~/.harness-x/tools/registry.json, plugin = tool 슬롯 플러그인 */
    source: z.enum(['registry', 'plugin']),
    /** 필요 권한 (플러그인 매니페스트에서) */
    permissions: Permissions.optional(),
    health: AssetHealthSchema,
  })
  .strict();
export type ToolAsset = z.infer<typeof ToolAssetSchema>;

export const McpServerAssetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    pluginId: z.string().optional(),
    tools: z.array(z.object({ name: z.string().min(1), description: z.string() }).strict()),
    permissions: Permissions.optional(),
    health: AssetHealthSchema,
  })
  .strict();
export type McpServerAsset = z.infer<typeof McpServerAssetSchema>;

/** 노드 요약: 역할명·엔진·스킬 id (지시문·스키마 본문은 넣지 않는다) */
export const NodeSummarySchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    label: z.string().optional(),
    engine: z.string().optional(),
    skills: z.array(z.string()),
    tools: z.array(z.string()),
  })
  .strict();
export type NodeSummary = z.infer<typeof NodeSummarySchema>;

export const AgentAssetSchema = z
  .object({
    name: z.string().min(1),
    command: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().optional(),
    source: z.enum(['user', 'project', 'plugin']),
    pluginId: z.string().optional(),
    defaultEngine: z.string(),
    nodes: z.array(NodeSummarySchema),
    health: AssetHealthSchema,
  })
  .strict();
export type AgentAsset = z.infer<typeof AgentAssetSchema>;

export const PipelineAssetSchema = z
  .object({
    /** <플러그인id>/<파이프라인 이름> */
    id: z.string().min(1),
    name: z.string().min(1),
    pluginId: z.string().min(1),
    nodes: z.array(NodeSummarySchema),
    health: AssetHealthSchema,
  })
  .strict();
export type PipelineAsset = z.infer<typeof PipelineAssetSchema>;

export const ComparatorAssetSchema = z.object({ kind: z.string().min(1), description: z.string() }).strict();
export type ComparatorAsset = z.infer<typeof ComparatorAssetSchema>;

export const WorkspaceContextSchema = z
  .object({
    /** 프로젝트 이름 (폴더 이름 또는 package.json name) */
    name: z.string(),
    hasAgentsMd: z.boolean(),
    hasClaudeMd: z.boolean(),
    /** 주요 언어 (많이 쓰인 순) */
    languages: z.array(z.string()),
    /** 프레임워크·플랫폼 추정 (예: Android, React) */
    frameworks: z.array(z.string()),
    /** 추정 근거 파일 이름 (경로·본문 아님) */
    evidence: z.array(z.string()),
  })
  .strict();
export type WorkspaceContext = z.infer<typeof WorkspaceContextSchema>;

export const InventorySchema = z
  .object({
    snapshotId: z.string().min(1),
    createdAt: z.iso.datetime(),
    plugins: z.array(PluginAssetSchema),
    skills: z.array(SkillAssetSchema),
    engines: z.array(EngineAssetSchema),
    tools: z.array(ToolAssetSchema),
    mcpServers: z.array(McpServerAssetSchema),
    agents: z.array(AgentAssetSchema),
    pipelines: z.array(PipelineAssetSchema),
    comparators: z.array(ComparatorAssetSchema),
    workspace: WorkspaceContextSchema,
  })
  .strict();
export type Inventory = z.infer<typeof InventorySchema>;

export function emptyWorkspaceContext(name = ''): WorkspaceContext {
  return { name, hasAgentsMd: false, hasClaudeMd: false, languages: [], frameworks: [], evidence: [] };
}
