import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  AGENT_FILE,
  AgentNameSchema,
  AgentSchema,
  PIPELINE_FILE,
  PipelineSchema,
  commandForName,
  stringifyAgent,
  stringifyPipeline,
  type AgentInput,
  type PipelineInput,
} from '@harness-x/protocol';

/**
 * 46.3 PUT /api/agents/:name — 빌더 저장
 * body: { agent: agent.yaml 객체(pipeline 생략 가능), pipeline: pipeline.yaml 객체, overwrite?: boolean }
 * → <home>/agents/<name>/agent.yaml + pipeline.yaml (home 기본 = HARNESS_X_HOME 또는 ~/.harness-x)
 * - 이름은 소문자 kebab-case, body.agent.name과 같아야 한다 (400)
 * - command가 없으면 /<이름>을 넣는다 (슬래시 명령 자동 제안과 같은 규칙)
 * - 이미 있으면 overwrite: true일 때만 덮어쓴다 (아니면 409)
 * 파일은 사용자가 보낸 그대로(기본값을 채우지 않고) YAML로 쓴다.
 */

export interface AgentSaveOptions {
  /** 하네스 홈 (요청마다 평가 — 기본 harnessHome()) */
  home: () => string;
  /** 저장 뒤 알림 (예: 레지스트리 다시 읽기) */
  onSaved?: (info: SavedAgent) => void;
}

export interface SavedAgent {
  name: string;
  command: string;
  dir: string;
  files: string[];
  created: boolean;
}

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ` : '') + i.message);

function atomicWrite(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function registerAgentSaveRoute(app: FastifyInstance, o: AgentSaveOptions): void {
  app.put('/api/agents/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const nameOk = AgentNameSchema.safeParse(name);
    if (!nameOk.success)
      return reply.code(400).send({ error: 'invalid_name', message: issues(nameOk.error).join('; ') });
    const body = (req.body ?? {}) as { agent?: unknown; pipeline?: unknown; overwrite?: unknown };
    if (!body.agent || typeof body.agent !== 'object' || !body.pipeline || typeof body.pipeline !== 'object')
      return reply.code(400).send({ error: 'invalid_body', message: 'agent·pipeline 객체가 필요합니다' });
    const raw = body.agent as Record<string, unknown>;
    if (raw.name !== undefined && raw.name !== name)
      return reply
        .code(400)
        .send({ error: 'name_mismatch', message: `agent.name '${String(raw.name)}' ≠ 경로 '${name}'` });

    const agent: AgentInput = {
      ...(raw as Partial<AgentInput>),
      name,
      command: typeof raw.command === 'string' && raw.command ? raw.command : commandForName(name),
      displayName: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : name,
      pipeline: `./${PIPELINE_FILE}`,
    } as AgentInput;
    const pipeline = body.pipeline as PipelineInput;
    const a = AgentSchema.safeParse(agent);
    const p = PipelineSchema.safeParse(pipeline);
    if (!a.success || !p.success)
      return reply.code(400).send({
        error: 'invalid_agent',
        errors: [
          ...(a.success ? [] : issues(a.error).map((m) => `agent.${m}`)),
          ...(p.success ? [] : issues(p.error).map((m) => `pipeline.${m}`)),
        ],
      });

    const dir = join(o.home(), 'agents', name);
    const existed = existsSync(join(dir, AGENT_FILE));
    if (existed && body.overwrite !== true)
      return reply.code(409).send({ error: 'exists', message: `이미 있는 에이전트: ${name}`, dir });
    mkdirSync(dir, { recursive: true });
    const pipelineFile = join(dir, PIPELINE_FILE);
    const agentFile = join(dir, AGENT_FILE);
    // pipeline 먼저 → agent.yaml (레지스트리는 agent.yaml이 있어야 읽는다)
    atomicWrite(pipelineFile, stringifyPipeline(pipeline));
    atomicWrite(agentFile, stringifyAgent(agent));
    const saved: SavedAgent = {
      name,
      command: agent.command,
      dir,
      files: [agentFile, pipelineFile],
      created: !existed,
    };
    o.onSaved?.(saved);
    return reply.code(existed ? 200 : 201).send(saved);
  });
}
