import { z } from 'zod';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/**
 * 파이프라인 스키마 (pipeline.yaml)
 * 플러그인(점선 틀) = 파이프라인, 그 안의 역할 노드 = 세부 담당, 노드 안의 칩 = 끼워 넣은 스킬.
 *
 * 그래프 규칙
 * - 노드 id는 파이프라인 안에서 유일, 엣지는 존재하는 노드만 가리킨다.
 * - 일반 엣지로 만든 순환은 loop 노드를 지나야만 허용된다.
 * - onFail 엣지는 gate 노드에서만 나가며, 그 gate의 상류(조상) 노드로 되돌린다(순환 검사에서 제외).
 * - router에서 나가는 엣지는 when 조건이 있어야 한다(default 엣지 1개 제외).
 */

// ── 공통 ──────────────────────────────────────────────────────
export const NODE_TYPES = ['role', 'gate', 'fanout', 'join', 'loop', 'router', 'subagent'] as const;
export const NodeTypeSchema = z.enum(NODE_TYPES);
export type NodeType = z.infer<typeof NodeTypeSchema>;

const NODE_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const NodeIdSchema = z
  .string()
  .regex(NODE_ID_RE, { message: '노드 id는 소문자 kebab-case (영문자로 시작)' });

/** 엔진 지정: 'auto'(라우팅에 맡김) 또는 엔진 id (예: claude-code, codex) */
export const EngineRefSchema = z
  .string()
  .regex(/^(auto|[a-z0-9]+([-.][a-z0-9]+)*)$/, { message: "engine은 'auto' 또는 엔진 id" });
export type EngineRef = z.infer<typeof EngineRefSchema>;

/** 인증 모드: 구독 / API 키 */
export const AuthModeSchema = z.enum(['subscription', 'apiKey']);
export type AuthMode = z.infer<typeof AuthModeSchema>;

/** 노드 권한 모드 (입력창 권한 칩과 같은 3단계) */
export const NodePermissionSchema = z.enum(['read-only', 'workspace-write', 'full']);
export type NodePermission = z.infer<typeof NodePermissionSchema>;

/** 노드 입출력 계약: JSON Schema 객체 (T-042에서 검증·호환성 검사) */
export const JsonSchemaObjectSchema = z.record(z.string(), z.unknown());
export type JsonSchemaObject = z.infer<typeof JsonSchemaObjectSchema>;

/** 조건식 (예: "output.verdict == 'pass'"). 해석은 실행기(T-041) 몫 */
export const ConditionSchema = z.string().trim().min(1);
export type Condition = z.infer<typeof ConditionSchema>;

const nodeBase = {
  id: NodeIdSchema,
  /** 캔버스에 표시할 이름 */
  label: z.string().min(1).optional(),
  description: z.string().optional(),
};

/**
 * 단계 범위·출구 조건 (T-101 4A.5·4B.4)
 *  artifacts: 이 노드(단계)가 쓸 수 있는 경로 패턴 / canModify: 산출물을 고쳐도 되는 다른 노드 id
 *  acceptance: 단계 출구 조건 (체크리스트 acceptance와 같은 모양, checklist-ledger가 검사)
 */
const stageScope = {
  artifacts: z.array(z.string().min(1)).optional(),
  canModify: z.array(NodeIdSchema).optional(),
  acceptance: z.array(z.record(z.string(), z.unknown())).optional(),
};

// ── 40.1 / 40.2 노드 7종 ─────────────────────────────────────
/** role: 엔진 세션 하나가 맡는 세부 담당 */
export const RoleNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal('role'),
    engine: EngineRefSchema.default('auto'),
    mode: AuthModeSchema.default('subscription'),
    /** 끼워 넣은 스킬 (순서 유지) */
    skills: z.array(z.string().min(1)).default([]),
    tools: z.array(z.string().min(1)).default([]),
    permission: NodePermissionSchema.default('workspace-write'),
    /** 이 노드의 체크리스트 템플릿 (경로 또는 id). 완료 조건 = 전 항목 done */
    checklistTemplate: z.string().min(1).optional(),
    ...stageScope,
    /** 노드 지시문 */
    prompt: z.string().optional(),
    inputSchema: JsonSchemaObjectSchema.optional(),
    outputSchema: JsonSchemaObjectSchema.optional(),
  })
  .strict();

/** gate: 판정기로 검사, 실패 항목만 onFail 엣지로 되돌린다 */
export const GateNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal('gate'),
    verifiers: z.array(z.string().min(1)).default([]),
    checklistTemplate: z.string().min(1).optional(),
    ...stageScope,
    /** onFail로 되돌리는 최대 횟수 */
    maxRetries: z.number().int().min(0).max(20).default(2),
  })
  .strict();

/** fanout: 나가는 엣지들을 병렬 실행 */
export const FanoutNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal('fanout'),
    maxConcurrency: z.number().int().min(1).max(3).default(3),
  })
  .strict();

/** join: 들어오는 갈래를 모은다 */
export const JoinNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal('join'),
    wait: z.enum(['all', 'any']).default('all'),
  })
  .strict();

/** loop: 순환의 시작점. 본문은 loop로 돌아오는 순환 경로의 노드들 */
export const LoopNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal('loop'),
    maxIterations: z.number().int().min(1).max(100).default(3),
    /** 이 조건이 참이면 반복 종료 */
    until: ConditionSchema.optional(),
    /** 출력 변화 없이 이 횟수만큼 반복하면 정체로 보고 중단 */
    stallLimit: z.number().int().min(1).default(2),
  })
  .strict();

/** router: 나가는 엣지의 when 조건으로 한 갈래를 고른다 */
export const RouterNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal('router'),
    /** 어느 조건도 맞지 않을 때 갈 노드 */
    default: NodeIdSchema.optional(),
  })
  .strict();

/** subagent: 다른 에이전트를 노드로 호출 */
export const SubagentNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal('subagent'),
    /** 에이전트 이름 또는 /명령 */
    agent: z.string().min(1),
    engine: EngineRefSchema.optional(),
    inputSchema: JsonSchemaObjectSchema.optional(),
    outputSchema: JsonSchemaObjectSchema.optional(),
  })
  .strict();

export const PipelineNodeSchema = z.discriminatedUnion('type', [
  RoleNodeSchema,
  GateNodeSchema,
  FanoutNodeSchema,
  JoinNodeSchema,
  LoopNodeSchema,
  RouterNodeSchema,
  SubagentNodeSchema,
]);

export type RoleNode = z.infer<typeof RoleNodeSchema>;
export type GateNode = z.infer<typeof GateNodeSchema>;
export type FanoutNode = z.infer<typeof FanoutNodeSchema>;
export type JoinNode = z.infer<typeof JoinNodeSchema>;
export type LoopNode = z.infer<typeof LoopNodeSchema>;
export type RouterNode = z.infer<typeof RouterNodeSchema>;
export type SubagentNode = z.infer<typeof SubagentNodeSchema>;
export type PipelineNode = z.infer<typeof PipelineNodeSchema>;
export type PipelineNodeInput = z.input<typeof PipelineNodeSchema>;
export type NodeOfType<T extends NodeType> = Extract<PipelineNode, { type: T }>;

// ── 40.3 엣지·조건 ───────────────────────────────────────────
export const PipelineEdgeSchema = z
  .object({
    from: NodeIdSchema,
    to: NodeIdSchema,
    /** 이 조건이 참일 때만 진행 (router 갈래, 일반 조건부 진행) */
    when: ConditionSchema.optional(),
    /** gate 실패 시 되돌림 엣지 (gate에서만, 상류 노드로만) */
    onFail: z.boolean().default(false),
  })
  .strict();
export type PipelineEdge = z.infer<typeof PipelineEdgeSchema>;

const PipelineObjectSchema = z
  .object({
    name: NodeIdSchema,
    displayName: z.string().min(1).optional(),
    description: z.string().optional(),
    version: z.literal(1).default(1),
    /** 시작 노드 (기본: 들어오는 일반 엣지가 없는 첫 노드) */
    entry: NodeIdSchema.optional(),
    nodes: z.array(PipelineNodeSchema).min(1),
    edges: z.array(PipelineEdgeSchema).default([]),
  })
  .strict();

/** 그래프 규칙 검사. 문제 목록(비면 통과) */
export function checkPipelineGraph(p: {
  entry?: string | undefined;
  nodes: readonly { id: string; type: NodeType; default?: string | undefined }[];
  edges: readonly { from: string; to: string; when?: string | undefined; onFail?: boolean | undefined }[];
}): string[] {
  const issues: string[] = [];
  const byId = new Map<string, NodeType>();
  for (const n of p.nodes) {
    if (byId.has(n.id)) issues.push(`노드 id 중복: ${n.id}`);
    byId.set(n.id, n.type);
  }
  if (p.entry && !byId.has(p.entry)) issues.push(`entry가 없는 노드를 가리킴: ${p.entry}`);
  const seen = new Set<string>();
  for (const e of p.edges) {
    for (const end of [e.from, e.to]) {
      if (!byId.has(end)) issues.push(`엣지 ${e.from} → ${e.to}: 없는 노드 ${end}`);
    }
    const key = `${e.from}>${e.to}>${e.onFail ? 'f' : 'n'}`;
    if (seen.has(key)) issues.push(`엣지 중복: ${e.from} → ${e.to}`);
    seen.add(key);
    if (e.from === e.to && byId.get(e.from) !== 'loop') issues.push(`자기 순환 금지: ${e.from}`);
  }
  if (issues.length) return issues;

  const normal = p.edges.filter((e) => !e.onFail);
  const out = new Map<string, string[]>([...byId.keys()].map((id) => [id, []]));
  for (const e of normal) out.get(e.from)!.push(e.to);

  // 순환 검사: loop 노드를 지우고도 남는 순환은 금지
  const cycle = findCycle(
    [...byId.keys()].filter((id) => byId.get(id) !== 'loop'),
    (id) => out.get(id)!.filter((t) => byId.get(t) !== 'loop'),
  );
  if (cycle) issues.push(`잘못된 순환 (loop 노드만 순환 허용): ${cycle.join(' → ')}`);

  // onFail: gate에서만, 상류 노드로만
  for (const e of p.edges.filter((x) => x.onFail)) {
    if (byId.get(e.from) !== 'gate') {
      issues.push(`onFail 엣지는 gate 노드에서만: ${e.from} → ${e.to}`);
      continue;
    }
    if (!reaches(out, e.to, e.from)) issues.push(`onFail은 상류 노드로만 되돌림: ${e.from} → ${e.to}`);
  }

  for (const n of p.nodes) {
    const outs = normal.filter((e) => e.from === n.id);
    const ins = normal.filter((e) => e.to === n.id);
    if (n.type === 'gate' && !p.edges.some((e) => e.onFail && e.from === n.id))
      issues.push(`gate ${n.id}: onFail 엣지가 필요함`);
    if (n.type === 'fanout' && outs.length < 2) issues.push(`fanout ${n.id}: 나가는 엣지 2개 이상 필요`);
    if (n.type === 'join' && ins.length < 2) issues.push(`join ${n.id}: 들어오는 엣지 2개 이상 필요`);
    if (n.type === 'loop') {
      if (!reaches(out, n.id, n.id, true)) issues.push(`loop ${n.id}: 자기에게 돌아오는 순환이 없음`);
    }
    if (n.type === 'router') {
      if (outs.length < 1) issues.push(`router ${n.id}: 나가는 엣지 필요`);
      if (n.default && !outs.some((e) => e.to === n.default))
        issues.push(`router ${n.id}: default ${n.default}로 가는 엣지가 없음`);
      for (const e of outs) {
        if (!e.when && e.to !== n.default) issues.push(`router ${n.id} → ${e.to}: when 조건 필요`);
      }
    }
  }

  // 시작 노드
  if (!p.entry) {
    const roots = [...byId.keys()].filter((id) => !normal.some((e) => e.to === id));
    if (roots.length === 0) issues.push('시작 노드가 없음 (entry를 지정하세요)');
  }
  return issues;
}

/** 일반 엣지 기준 from에서 to로 갈 수 있는지 (strict면 길이 1 이상 경로) */
function reaches(out: Map<string, string[]>, from: string, to: string, strict = false): boolean {
  const stack = strict ? [...(out.get(from) ?? [])] : [from];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(out.get(id) ?? []));
  }
  return false;
}

function findCycle(ids: string[], next: (id: string) => string[]): string[] | undefined {
  const color = new Map<string, 0 | 1 | 2>(ids.map((id) => [id, 0]));
  const path: string[] = [];
  const dfs = (id: string): string[] | undefined => {
    color.set(id, 1);
    path.push(id);
    for (const t of next(id)) {
      if (color.get(t) === 1) return [...path.slice(path.indexOf(t)), t];
      if (color.get(t) === 0) {
        const c = dfs(t);
        if (c) return c;
      }
    }
    path.pop();
    color.set(id, 2);
    return undefined;
  };
  for (const id of ids) {
    if (color.get(id) === 0) {
      const c = dfs(id);
      if (c) return c;
    }
  }
  return undefined;
}

export const PipelineSchema = PipelineObjectSchema.superRefine((p, ctx) => {
  for (const message of checkPipelineGraph(p)) ctx.addIssue({ code: 'custom', message, path: ['edges'] });
});
export type Pipeline = z.infer<typeof PipelineSchema>;
export type PipelineInput = z.input<typeof PipelineSchema>;

export function parsePipeline(value: unknown): Pipeline {
  return PipelineSchema.parse(value);
}

export function parsePipelineYaml(text: string): Pipeline {
  return parsePipeline(parseYaml(text));
}

/** YAML로 직렬화 (parsePipelineYaml과 왕복 동일) */
export function stringifyPipeline(p: PipelineInput | Pipeline): string {
  return stringifyYaml(p, { lineWidth: 0 });
}

/** 시작 노드: entry 또는 들어오는 일반 엣지가 없는 첫 노드 */
export function pipelineEntry(p: Pipeline): string {
  if (p.entry) return p.entry;
  const root = p.nodes.find((n) => !p.edges.some((e) => !e.onFail && e.to === n.id));
  return (root ?? p.nodes[0]!).id;
}
