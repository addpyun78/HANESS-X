import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  AGENT_FILE,
  AgentSchema,
  PIPELINE_FILE,
  PipelineSchema,
  parseAgentYaml,
  parsePipelineYaml,
  parsePluginPipelineRef,
  type Agent,
  type AgentSource,
  type AgentSummary,
  type Pipeline,
  type PluginManifest,
} from '@harness-x/protocol';
import { harnessHome } from '@harness-x/kernel';

/**
 * 에이전트 레지스트리
 * 출처 3가지를 모아 /명령으로 부를 수 있는 에이전트 목록을 만든다.
 * - plugin: provides.command만 있는 플러그인 → 명령마다 단일 role 노드 에이전트
 *           provides.pipeline이 있는 플러그인 → 파이프라인마다 에이전트
 * - user:    ~/.harness-x/agents/<이름>/agent.yaml (HARNESS_X_HOME 존중)
 * - project: <workspace>/.harness-x/agents/<이름>/agent.yaml
 * 이름 충돌: user > project > plugin. 플러그인 에이전트가 충돌하면 '<플러그인id>:<이름>'으로 바꿔 등록한다.
 */

/** 레지스트리가 보는 플러그인 (kernel LoadedPlugin과 호환) */
export interface PluginLike {
  manifest: PluginManifest;
  dir: string;
  /** 지정되면 'active'인 것만 쓴다 */
  state?: string;
}

export interface RegisteredAgent {
  /** 레지스트리 안에서 유일한 이름 */
  name: string;
  /** 입력창에서 부르는 명령 (/이름) */
  command: string;
  /** 원래 선언된 이름 (충돌로 바뀌기 전) */
  declaredName: string;
  source: AgentSource;
  pluginId?: string;
  /** agent.yaml 또는 플러그인 폴더 */
  dir: string;
  agent: Agent;
  pipeline: Pipeline;
}

export interface RegistryIssue {
  source: AgentSource;
  path: string;
  reason: string;
}

export interface AgentRegistryOptions {
  /** 플러그인 목록 (예: () => loader.plugins.values()) */
  plugins?: () => Iterable<PluginLike>;
  /** 하네스 홈 (기본 harnessHome()) */
  home?: string;
  /** 프로젝트 폴더 (있으면 <workspace>/.harness-x/agents 를 읽는다) */
  workspace?: string;
}

const RANK: Record<AgentSource, number> = { user: 0, project: 1, plugin: 2 };

export class AgentRegistry {
  private readonly opts: AgentRegistryOptions;
  /** 마지막 list()에서 생긴 문제 (읽기·검증 실패) */
  issues: RegistryIssue[] = [];
  /** 마지막 list()에서 우선순위에 밀려 가려진 에이전트 */
  shadowed: RegisteredAgent[] = [];

  constructor(opts: AgentRegistryOptions = {}) {
    this.opts = opts;
  }

  /** 모든 출처를 다시 읽어 충돌 규칙을 적용한 목록 (이름순) */
  list(): RegisteredAgent[] {
    this.issues = [];
    this.shadowed = [];
    const plugins = [...(this.opts.plugins?.() ?? [])].filter((p) => !p.state || p.state === 'active');
    const candidates: RegisteredAgent[] = [
      ...this.scanDir(join(this.opts.home ?? harnessHome(), 'agents'), 'user', plugins),
      ...(this.opts.workspace
        ? this.scanDir(join(this.opts.workspace, '.harness-x', 'agents'), 'project', plugins)
        : []),
      ...plugins.flatMap((p) => this.fromPlugin(p)),
    ];
    return this.resolveConflicts(candidates);
  }

  /** 이름 또는 /명령으로 찾기 */
  get(nameOrCommand: string): RegisteredAgent | undefined {
    const all = this.list();
    return all.find((a) => a.command === nameOrCommand || a.name === nameOrCommand);
  }

  /** GET /api/agents 용 요약 */
  summaries(): AgentSummary[] {
    return this.list().map(toSummary);
  }

  // ── 플러그인 ──────────────────────────────────────────────
  private fromPlugin(p: PluginLike): RegisteredAgent[] {
    const m = p.manifest;
    const pipelines = m.provides.pipeline ?? [];
    if (pipelines.length > 0) {
      const out: RegisteredAgent[] = [];
      for (const name of pipelines) {
        try {
          out.push(this.pluginPipelineAgent(p, name, pipelines.length));
        } catch (err) {
          this.issue('plugin', p.dir, `${m.id} 파이프라인 '${name}': ${errMsg(err)}`);
        }
      }
      return out;
    }
    const commands = m.provides.command ?? [];
    const onlyCommand = Object.entries(m.provides).every(
      ([slot, v]) => slot === 'command' || !Array.isArray(v) || v.length === 0,
    );
    if (!onlyCommand) return [];
    return commands.map((command) => commandAgent(p, command));
  }

  private pluginPipelineAgent(p: PluginLike, name: string, count: number): RegisteredAgent {
    const pipeline = loadPluginPipeline(p, name);
    const metaFile = join(p.dir, AGENT_FILE);
    let agent: Agent | undefined;
    if (existsSync(metaFile)) {
      const meta = parseAgentYaml(readFileSync(metaFile, 'utf8'));
      if (meta.name === name || count === 1) agent = { ...meta, pipeline: `plugin:${p.manifest.id}/${name}` };
    }
    agent ??= AgentSchema.parse({
      name,
      displayName: pipeline.displayName ?? p.manifest.displayName ?? name,
      ...(pipeline.description || p.manifest.description
        ? { description: pipeline.description ?? p.manifest.description }
        : {}),
      command: `/${name}`,
      pipeline: `plugin:${p.manifest.id}/${name}`,
    });
    return {
      name: agent.name,
      declaredName: agent.name,
      command: agent.command,
      source: 'plugin',
      pluginId: p.manifest.id,
      dir: p.dir,
      agent,
      pipeline,
    };
  }

  // ── 사용자·프로젝트 ───────────────────────────────────────
  private scanDir(root: string, source: AgentSource, plugins: PluginLike[]): RegisteredAgent[] {
    if (!existsSync(root)) return [];
    const out: RegisteredAgent[] = [];
    for (const entry of readdirSync(root).sort()) {
      const dir = join(root, entry);
      const file = join(dir, AGENT_FILE);
      try {
        if (!statSync(dir).isDirectory() || !existsSync(file)) continue;
        const agent = parseAgentYaml(readFileSync(file, 'utf8'));
        const pipeline = resolvePipelineRef(agent, dir, plugins);
        out.push({
          name: agent.name,
          declaredName: agent.name,
          command: agent.command,
          source,
          dir,
          agent,
          pipeline,
        });
      } catch (err) {
        this.issue(source, file, errMsg(err));
      }
    }
    return out;
  }

  // ── 43.4 충돌 규칙 ────────────────────────────────────────
  private resolveConflicts(candidates: RegisteredAgent[]): RegisteredAgent[] {
    const groups = new Map<string, RegisteredAgent[]>();
    for (const c of candidates) {
      const g = groups.get(c.declaredName) ?? [];
      g.push(c);
      groups.set(c.declaredName, g);
    }
    const out: RegisteredAgent[] = [];
    for (const [name, group] of groups) {
      group.sort((a, b) => RANK[a.source] - RANK[b.source]);
      const local = group.filter((g) => g.source !== 'plugin');
      const fromPlugins = group.filter((g) => g.source === 'plugin');
      if (local.length) {
        out.push(local[0]!);
        this.shadowed.push(...local.slice(1));
      }
      if (fromPlugins.length === 1 && local.length === 0) {
        out.push(fromPlugins[0]!);
        continue;
      }
      for (const p of fromPlugins) {
        const qualified = `${p.pluginId}:${name}`;
        out.push({ ...p, name: qualified, command: `/${qualified}` });
      }
    }
    // 이름을 바꿨는데도 겹치는 경우(같은 플러그인이 같은 이름 둘)는 뒤의 것을 가린다
    const seen = new Set<string>();
    const unique = out.filter((a) => {
      if (seen.has(a.name)) {
        this.shadowed.push(a);
        return false;
      }
      seen.add(a.name);
      return true;
    });
    return unique.sort((a, b) => a.name.localeCompare(b.name));
  }

  private issue(source: AgentSource, path: string, reason: string): void {
    this.issues.push({ source, path, reason });
  }
}

/** 43.1 명령 하나 → 단일 role 노드 에이전트 */
function commandAgent(p: PluginLike, command: string): RegisteredAgent {
  const m = p.manifest;
  const name = command.slice(1);
  const pipeline = PipelineSchema.parse({
    name,
    ...(m.displayName ? { displayName: m.displayName } : {}),
    nodes: [
      {
        id: 'main',
        type: 'role',
        label: m.displayName ?? name,
        ...(m.description ? { description: m.description } : {}),
        /** 이 노드는 플러그인 명령을 실행한다 */
        prompt: command,
      },
    ],
  });
  const agent = AgentSchema.parse({
    name,
    displayName: m.displayName ?? name,
    ...(m.description ? { description: m.description } : {}),
    command,
    pipeline: `plugin:${m.id}/${name}`,
  });
  return {
    name,
    declaredName: name,
    command,
    source: 'plugin',
    pluginId: m.id,
    dir: p.dir,
    agent,
    pipeline,
  };
}

/** 플러그인 폴더에서 파이프라인 찾기: pipelines/<이름>.yaml → <이름>.pipeline.yaml → pipeline.yaml(name 일치) */
export function loadPluginPipeline(p: PluginLike, name: string): Pipeline {
  const candidates = [join(p.dir, 'pipelines', `${name}.yaml`), join(p.dir, `${name}.pipeline.yaml`)];
  for (const file of candidates) {
    if (existsSync(file)) return readPipeline(file);
  }
  const single = join(p.dir, PIPELINE_FILE);
  if (existsSync(single)) {
    const pl = readPipeline(single);
    if (pl.name === name) return pl;
    throw new Error(`${PIPELINE_FILE}의 name '${pl.name}'이 '${name}'과 다름`);
  }
  throw new Error(`파이프라인 파일 없음 (pipelines/${name}.yaml, ${name}.pipeline.yaml, ${PIPELINE_FILE})`);
}

function readPipeline(file: string): Pipeline {
  return parsePipelineYaml(readFileSync(file, 'utf8'));
}

function resolvePipelineRef(agent: Agent, dir: string, plugins: PluginLike[]): Pipeline {
  const ref = agent.pipeline;
  if (typeof ref !== 'string') return ref;
  const plug = parsePluginPipelineRef(ref);
  if (plug) {
    const p = plugins.find((x) => x.manifest.id === plug.pluginId);
    if (!p) throw new Error(`참조한 플러그인 없음: ${plug.pluginId}`);
    return loadPluginPipeline(p, plug.pipeline);
  }
  const file = resolve(dir, ref);
  const rel = relative(dir, file);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`pipeline 경로가 에이전트 폴더 밖: ${ref}`);
  return readPipeline(file);
}

export function toSummary(a: RegisteredAgent): AgentSummary {
  return {
    name: a.name,
    command: a.command,
    displayName: a.agent.displayName,
    ...(a.agent.description ? { description: a.agent.description } : {}),
    ...(a.agent.icon ? { icon: a.agent.icon } : {}),
    source: a.source,
    ...(a.pluginId ? { pluginId: a.pluginId } : {}),
    defaultEngine: a.agent.defaultEngine,
    nodeCount: a.pipeline.nodes.length,
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
