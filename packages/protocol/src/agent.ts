import { z } from 'zod';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { EngineRefSchema, PipelineSchema } from './pipeline.js';

/**
 * 에이전트 스키마 (agent.yaml)
 * 에이전트 = 이름·아이콘·슬래시 명령 + 파이프라인 참조. 입력창에서 /명령으로 부른다.
 */

const AGENT_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const AgentNameSchema = z
  .string()
  .regex(AGENT_NAME_RE, { message: '에이전트 이름은 소문자 kebab-case (영문자로 시작)' });

/** 슬래시 명령 (manifest provides.command와 같은 형식) */
export const SlashCommandSchema = z
  .string()
  .regex(/^\/[a-z0-9][a-z0-9-]*$/, { message: 'command는 /이름 형식 (소문자 kebab-case)' });

/**
 * 파이프라인 참조
 * - 상대 경로: './pipeline.yaml' (agent.yaml 기준)
 * - 플러그인 파이프라인: 'plugin:<플러그인id>/<파이프라인 이름>'
 * - 인라인: 파이프라인 객체
 */
export const PipelineRefSchema = z.union([
  z
    .string()
    .min(1)
    .refine((s) => isPluginPipelineRef(s) || isRelativePipelinePath(s), {
      message: "pipeline은 상대 경로(./pipeline.yaml) 또는 'plugin:<id>/<이름>'",
    }),
  PipelineSchema,
]);
export type PipelineRef = z.infer<typeof PipelineRefSchema>;

export const AgentSchema = z
  .object({
    name: AgentNameSchema,
    displayName: z.string().min(1),
    description: z.string().optional(),
    /** 아이콘: 이모지나 짧은 아이콘 이름 */
    icon: z.string().min(1).max(32).optional(),
    command: SlashCommandSchema,
    defaultEngine: EngineRefSchema.default('auto'),
    /** T-100 P4-F.6 빈 칸이 남은 채 저장되면 incomplete — 목록에 회색, 실행은 막힌다 */
    status: z.enum(['ready', 'incomplete']).optional(),
    pipeline: PipelineRefSchema,
  })
  .strict();
export type Agent = z.infer<typeof AgentSchema>;
export type AgentInput = z.input<typeof AgentSchema>;

export const AGENT_FILE = 'agent.yaml';
export const PIPELINE_FILE = 'pipeline.yaml';

export function parseAgent(value: unknown): Agent {
  return AgentSchema.parse(value);
}

export function parseAgentYaml(text: string): Agent {
  return parseAgent(parseYaml(text));
}

export function stringifyAgent(a: AgentInput | Agent): string {
  return stringifyYaml(a, { lineWidth: 0 });
}

const PLUGIN_REF_RE = /^plugin:([a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*)\/([a-z][a-z0-9-]*)$/;

export function isPluginPipelineRef(s: string): boolean {
  return PLUGIN_REF_RE.test(s);
}

/** 'plugin:<id>/<이름>' 분해 */
export function parsePluginPipelineRef(s: string): { pluginId: string; pipeline: string } | undefined {
  const m = PLUGIN_REF_RE.exec(s);
  return m ? { pluginId: m[1]!, pipeline: m[2]! } : undefined;
}

/** 상대 경로만 허용 (절대 경로·상위 폴더 탈출 금지) */
function isRelativePipelinePath(s: string): boolean {
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s) || s.includes('\\')) return false;
  if (s.split('/').includes('..')) return false;
  return /\.ya?ml$/.test(s);
}

// ── 에이전트 목록 (GET /api/agents) ──────────────────────────
/** 등록 출처. 이름 충돌 시 우선순위: user > project > plugin */
export const AGENT_SOURCES = ['user', 'project', 'plugin'] as const;
export const AgentSourceSchema = z.enum(AGENT_SOURCES);
export type AgentSource = z.infer<typeof AgentSourceSchema>;

export const AgentSummarySchema = z
  .object({
    /** 레지스트리 안에서 유일한 이름 (충돌한 플러그인 에이전트는 '<플러그인id>:<이름>') */
    name: z.string().min(1),
    command: z.string().regex(/^\/\S+$/),
    displayName: z.string().min(1),
    description: z.string().optional(),
    icon: z.string().optional(),
    source: AgentSourceSchema,
    pluginId: z.string().optional(),
    defaultEngine: z.string().min(1),
    nodeCount: z.number().int().min(1),
    /** T-100 P4-F.6 incomplete = 빈 칸을 채워야 실행된다 */
    status: z.enum(['ready', 'incomplete']).optional(),
  })
  .strict();
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const AgentListResponseSchema = z.object({ agents: z.array(AgentSummarySchema) }).strict();
export type AgentListResponse = z.infer<typeof AgentListResponseSchema>;

/** 명령 기본값 제안: 이름 → /이름 */
/** T-100 P4-F.6 incomplete 에이전트를 부르면 보여 줄 안내 */
export const INCOMPLETE_AGENT_MESSAGE = '빈 칸을 먼저 채워 주세요.';

export function commandForName(name: string): string {
  return `/${name}`;
}
