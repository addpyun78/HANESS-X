import { randomUUID } from 'node:crypto';
import {
  EngineRefSchema,
  INCOMPLETE_AGENT_MESSAGE,
  type Pipeline,
  type PipelineNode,
} from '@harness-x/protocol';
import type { LogRecord } from './event-log.js';
import { SessionRegistry } from './projects/session-registry.js';
import type { SessionOrigin, SessionState } from './projects/schema.js';

/**
 * T-048 / 실행 디스패치
 * 입력창의 에이전트 칩 + 지시문 → 그 에이전트 파이프라인으로 새 세션을 시작한다.
 *
 * - 수식어(48.2): 지시문 안의 공백으로 구분된 낱말
 *   @엔진   이번 실행만 모든 role 노드(와 엔진을 지정한 subagent 노드)의 엔진을 바꾼다 (예: @codex)
 *   #strict 엄격 모드: 출력 계약 재요청 없이 첫 불충족에서 멈춘다 (실행기 maxContractRetries: 0)
 *   !plan   계획만: 시작 노드 하나만 읽기 전용으로 실행한다
 *   수식어는 지시문에서 빠지고, 나머지 글은 그대로 남는다. 'a@b'처럼 낱말 중간의 @는 수식어가 아니다.
 * - 실행기(PipelineRunner)는 agent-builder 패키지에 있으므로 커널은 그것을 import하지 않는다.
 *   cli.ts가 로드된 agent-builder 플러그인 모듈로 resolve·run을 만들어 주입한다(순환 의존 방지).
 * - 세션 진행: session_created → (실행기 node_start/node_end…) → session_end 를 이벤트 로그에 남기고,
 *   현재 노드·진행률(완료 노드 / 노드 수)을 메모리에 들고 있다 (GET /api/sessions).
 * - 48.4 실행 중 세션에 다른 에이전트를 서브에이전트로 추가하면, 본 파이프라인이 끝난 뒤 같은 세션에서
 *   차례로 실행한다(앞 결과를 지시문에 붙여 넘김).
 */

// ── 48.2 수식어 ─────────────────────────────────────────────
export interface DispatchModifiers {
  /** @엔진: 이번 실행만 엔진 교체 */
  engine?: string;
  /** #strict */
  strict: boolean;
  /** !plan: 계획만 */
  planOnly: boolean;
}

export interface ParsedInstruction {
  /** 수식어를 뺀 지시문 */
  prompt: string;
  modifiers: DispatchModifiers;
  /** 찾은 수식어 낱말 (원문 그대로, 순서대로) */
  tokens: string[];
}

const ENGINE_TOKEN = /^@([A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*)$/;

export function parseModifiers(text: string): ParsedInstruction {
  const modifiers: DispatchModifiers = { strict: false, planOnly: false };
  const tokens: string[] = [];
  // 공백 덩어리와 낱말을 번갈아 나눈 뒤, 수식어 낱말과 그 앞 공백을 뺀다
  const parts = text.split(/(\s+)/);
  const kept: string[] = [];
  for (const part of parts) {
    if (!part || /^\s+$/.test(part)) {
      kept.push(part);
      continue;
    }
    const lower = part.toLowerCase();
    const engine = ENGINE_TOKEN.exec(part);
    if (engine) modifiers.engine = engine[1]!.toLowerCase();
    else if (lower === '#strict') modifiers.strict = true;
    else if (lower === '!plan') modifiers.planOnly = true;
    else {
      kept.push(part);
      continue;
    }
    tokens.push(part);
    // 앞 공백 하나를 같이 지운다 (줄바꿈은 남긴다)
    const prev = kept[kept.length - 1];
    if (prev !== undefined && /^[ \t]+$/.test(prev)) kept.pop();
  }
  const prompt = kept
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return { prompt, modifiers, tokens };
}

/** 수식어를 파이프라인에 적용 (원본은 바꾸지 않는다) */
export function applyModifiers(pipeline: Pipeline, m: Partial<DispatchModifiers>): Pipeline {
  let nodes: PipelineNode[] = pipeline.nodes.map((n) => {
    if (!m.engine) return n;
    if (n.type === 'role') return { ...n, engine: m.engine };
    if (n.type === 'subagent' && n.engine) return { ...n, engine: m.engine };
    return n;
  });
  let edges = pipeline.edges;
  let entry = pipeline.entry;
  if (m.planOnly) {
    const first = entryOf({ ...pipeline, nodes });
    nodes = [first.type === 'role' ? { ...first, permission: 'read-only' } : first];
    edges = [];
    entry = first.id;
  }
  return { ...pipeline, nodes, edges, ...(entry ? { entry } : {}) };
}

function entryOf(p: Pipeline): PipelineNode {
  if (p.entry) {
    const n = p.nodes.find((x) => x.id === p.entry);
    if (n) return n;
  }
  return p.nodes.find((n) => !p.edges.some((e) => !e.onFail && e.to === n.id)) ?? p.nodes[0]!;
}

// ── 디스패처 ─────────────────────────────────────────────────
export interface DispatchAgent {
  name: string;
  command: string;
  displayName: string;
  icon?: string;
  defaultEngine?: string;
  /** T-100 P4-F.6 빈 칸이 남은 에이전트는 실행하지 않는다 */
  status?: 'ready' | 'incomplete';
  pipeline: Pipeline;
}

export interface DispatchRunInput {
  sessionId: string;
  agent: DispatchAgent;
  /** 수식어를 적용한 파이프라인 */
  pipeline: Pipeline;
  prompt: string;
  modifiers: DispatchModifiers;
  /** 실행기 이벤트(node_start/node_end 등) — 진행률 추적용. 로그 기록은 실행기가 맡는다 */
  onEvent: (rec: LogRecord) => void;
  signal: AbortSignal;
}

export interface DispatchRunResult {
  status: string;
  reason?: string;
  haltedAt?: string;
  result?: unknown;
}

export type DispatchRunFn = (input: DispatchRunInput) => Promise<DispatchRunResult>;

export interface DispatcherOptions {
  /** 이름 또는 /명령 → 에이전트 (예: agent-builder AgentRegistry.get) */
  resolve: (nameOrCommand: string) => DispatchAgent | undefined;
  /** 파이프라인 실행 (예: agent-builder PipelineRunner) */
  run: DispatchRunFn;
  /** session_created / session_end / subagent_added 를 남길 곳 */
  log?: { append(rec: LogRecord): unknown };
  /** 알려진 엔진 id (있으면 @엔진을 검사한다) */
  engines?: () => readonly string[];
  idGen?: () => string;
  now?: () => Date;
  /** T-101 0B.37 세션 등록부 (세션은 createSession() 하나로만 만든다). 없으면 메모리 등록부 */
  sessions?: SessionRegistry;
}

export type DispatchSessionStatus = 'running' | 'completed' | 'incomplete' | 'failed' | 'error' | string;

export interface DispatchSession {
  sessionId: string;
  agent: { name: string; command: string; displayName: string; icon?: string };
  prompt: string;
  modifiers: DispatchModifiers;
  status: DispatchSessionStatus;
  /** 실행 중인 노드 */
  currentNode?: string;
  completedNodes: string[];
  nodeCount: number;
  /** 0~1 */
  progress: number;
  startedAt: string;
  endedAt?: string;
  reason?: string;
  haltedAt?: string;
  /** 48.4 추가된 서브에이전트 (/명령) */
  subagents: string[];
}

export type DispatchErrorCode =
  'invalid_request' | 'unknown_agent' | 'unknown_engine' | 'not_found' | 'not_running' | 'incomplete_agent';

export class DispatchError extends Error {
  constructor(
    readonly code: DispatchErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface DispatchRequest {
  /** 이름 또는 /명령 */
  agent: string;
  prompt: string;
  /** 지시문 밖에서 따로 준 수식어 (지시문 안 수식어 위에 덮어쓴다) */
  modifiers?: Partial<DispatchModifiers>;
  /** T-101 0B.39 만들 때 직접 저장할 프로젝트 (없으면 지금 고른 프로젝트) */
  projectId?: string;
  /** 어디서 시작했나 (기본 'slash' = 입력창 / 실행) */
  origin?: SessionOrigin;
}

interface Live {
  session: DispatchSession;
  done: Promise<DispatchSession>;
  queue: DispatchAgent[];
  abort: AbortController;
}

export class Dispatcher {
  private readonly opts: DispatcherOptions;
  private readonly live = new Map<string, Live>();
  private readonly idGen: () => string;
  private readonly now: () => Date;
  /** T-101 0B.37 세션 등록부 */
  readonly registry: SessionRegistry;

  constructor(opts: DispatcherOptions) {
    this.opts = opts;
    this.idGen = opts.idGen ?? randomUUID;
    this.now = opts.now ?? (() => new Date());
    this.registry = opts.sessions ?? new SessionRegistry({ memory: true, now: this.now });
  }

  /** 48.1 새 세션 시작 (실행은 비동기로 계속된다) */
  dispatch(req: DispatchRequest): DispatchSession {
    if (typeof req.agent !== 'string' || !req.agent.trim())
      throw new DispatchError('invalid_request', 'agent가 필요합니다');
    if (typeof req.prompt !== 'string') throw new DispatchError('invalid_request', 'prompt가 필요합니다');
    const agent = this.resolveAgent(req.agent);
    const parsed = parseModifiers(req.prompt);
    const modifiers: DispatchModifiers = { ...parsed.modifiers, ...clean(req.modifiers) };
    this.checkEngine(modifiers.engine);
    const pipeline = applyModifiers(agent.pipeline, modifiers);
    // 0B.37 세션 등록은 createSession() 하나로 (id·projectId·사이드바 반영이 모두 여기서)
    const { id: sessionId } = this.registry.createSession({
      origin: req.origin ?? 'slash',
      idPrefix: 'dispatch-',
      idGen: this.idGen,
      ...(req.projectId ? { projectId: req.projectId } : {}),
      agent: agent.name,
      ...(agent.icon ? { agentIcon: agent.icon } : {}),
      ...(modifiers.engine ? { engine: modifiers.engine } : {}),
      status: 'running',
      firstMessage: parsed.prompt || req.prompt,
    });
    const session: DispatchSession = {
      sessionId,
      agent: {
        name: agent.name,
        command: agent.command,
        displayName: agent.displayName,
        ...(agent.icon ? { icon: agent.icon } : {}),
      },
      prompt: parsed.prompt,
      modifiers,
      status: 'running',
      completedNodes: [],
      nodeCount: pipeline.nodes.length,
      progress: 0,
      startedAt: this.now().toISOString(),
      subagents: [],
    };
    this.emit(sessionId, 'session_created', {
      agent: session.agent.name,
      command: session.agent.command,
      displayName: session.agent.displayName,
      ...(session.agent.icon ? { icon: session.agent.icon } : {}),
      pipeline: pipeline.name,
      nodes: pipeline.nodes.map((n) => n.id),
      nodeCount: session.nodeCount,
      prompt: session.prompt,
      modifiers,
    });
    const abort = new AbortController();
    const live: Live = { session, queue: [], abort, done: Promise.resolve(session) };
    this.live.set(sessionId, live);
    live.done = this.execute(live, agent, pipeline);
    return snapshot(session);
  }

  /** 48.4 실행 중 세션에 서브에이전트 추가 (본 파이프라인 뒤에 실행) */
  addSubagent(sessionId: string, nameOrCommand: string): DispatchSession {
    const live = this.live.get(sessionId);
    if (!live) throw new DispatchError('not_found', `세션 없음: ${sessionId}`);
    if (live.session.status !== 'running')
      throw new DispatchError('not_running', `실행 중이 아닌 세션: ${sessionId}`);
    const agent = this.resolveAgent(nameOrCommand);
    live.queue.push(agent);
    live.session.subagents.push(agent.command);
    live.session.nodeCount += agent.pipeline.nodes.length;
    live.session.progress = progressOf(live.session);
    this.emit(sessionId, 'subagent_added', {
      agent: agent.name,
      command: agent.command,
      nodeCount: agent.pipeline.nodes.length,
    });
    return snapshot(live.session);
  }

  sessions(): DispatchSession[] {
    return [...this.live.values()].map((l) => snapshot(l.session));
  }

  get(sessionId: string): DispatchSession | undefined {
    const l = this.live.get(sessionId);
    return l ? snapshot(l.session) : undefined;
  }

  /** 세션이 끝날 때까지 기다린다 */
  async wait(sessionId: string): Promise<DispatchSession> {
    const l = this.live.get(sessionId);
    if (!l) throw new DispatchError('not_found', `세션 없음: ${sessionId}`);
    return snapshot(await l.done);
  }

  /** 실행 중인 세션을 모두 멈춘다 (서버 종료 시) */
  abortAll(): void {
    for (const l of this.live.values()) l.abort.abort();
  }

  // ── 내부 ───────────────────────────────────────────────────
  private resolveAgent(nameOrCommand: string): DispatchAgent {
    const key = nameOrCommand.trim();
    const agent =
      this.opts.resolve(key) ?? (key.startsWith('/') ? this.opts.resolve(key.slice(1)) : undefined);
    if (!agent) throw new DispatchError('unknown_agent', `에이전트 없음: ${nameOrCommand}`);
    if (agent.status === 'incomplete') throw new DispatchError('incomplete_agent', INCOMPLETE_AGENT_MESSAGE);
    return agent;
  }

  private checkEngine(engine: string | undefined) {
    if (!engine) return;
    if (!EngineRefSchema.safeParse(engine).success || engine === 'auto')
      throw new DispatchError('unknown_engine', `잘못된 엔진: @${engine}`);
    const known = this.opts.engines?.();
    if (known && !known.includes(engine))
      throw new DispatchError(
        'unknown_engine',
        `감지되지 않은 엔진: @${engine} (사용 가능: ${known.join(', ')})`,
      );
  }

  private async execute(live: Live, first: DispatchAgent, firstPipeline: Pipeline): Promise<DispatchSession> {
    const s = live.session;
    let agent = first;
    let pipeline = firstPipeline;
    let prompt = s.prompt;
    let prefix = '';
    try {
      for (;;) {
        const p = prefix;
        const r = await this.opts.run({
          sessionId: s.sessionId,
          agent,
          pipeline,
          prompt,
          modifiers: s.modifiers,
          onEvent: (rec) => this.track(s, rec, p),
          signal: live.abort.signal,
        });
        s.currentNode = undefined;
        if (r.status !== 'completed' || live.queue.length === 0) {
          this.finish(s, r.status, r.reason, r.haltedAt);
          break;
        }
        agent = live.queue.shift()!;
        prefix = `${agent.name}/`;
        pipeline = applyModifiers(agent.pipeline, s.modifiers);
        prompt = `${s.prompt}\n\n앞 단계 결과:\n${JSON.stringify(r.result ?? null)}`;
      }
    } catch (err) {
      this.finish(s, 'error', err instanceof Error ? err.message : String(err));
    }
    return s;
  }

  /** prefix: 서브에이전트 노드는 '<에이전트>/<노드>'로 센다 (본 파이프라인과 id가 겹쳐도 따로) */
  private track(s: DispatchSession, rec: LogRecord, prefix: string) {
    const nodeId = typeof rec.nodeId === 'string' ? prefix + rec.nodeId : undefined;
    if (!nodeId) return;
    if (rec.type === 'node_start') s.currentNode = nodeId;
    if (rec.type === 'node_end') {
      if (rec.status === 'completed' || rec.status === 'max_iterations') {
        s.completedNodes.push(nodeId);
        s.progress = progressOf(s);
      }
      if (s.currentNode === nodeId) s.currentNode = undefined;
    }
  }

  private finish(s: DispatchSession, status: string, reason?: string, haltedAt?: string) {
    s.status = status;
    this.registry.setStatus(s.sessionId, registryState(status));
    s.endedAt = this.now().toISOString();
    if (reason) s.reason = reason;
    if (haltedAt) s.haltedAt = haltedAt;
    if (status === 'completed') s.progress = 1;
    this.emit(s.sessionId, 'session_end', {
      status,
      progress: s.progress,
      ...(reason ? { reason } : {}),
      ...(haltedAt ? { haltedAt } : {}),
    });
  }

  private emit(sessionId: string, type: string, body: Record<string, unknown>) {
    this.opts.log?.append({ id: this.idGen(), ts: this.now().toISOString(), sessionId, type, ...body });
  }
}

function registryState(status: string): SessionState {
  if (status === 'completed') return 'done';
  if (status === 'running') return 'running';
  if (status === 'error' || status === 'failed') return 'error';
  return 'paused';
}

function progressOf(s: DispatchSession): number {
  if (s.nodeCount <= 0) return 0;
  return Math.min(1, new Set(s.completedNodes).size / s.nodeCount);
}

function clean(m: Partial<DispatchModifiers> | undefined): Partial<DispatchModifiers> {
  if (!m || typeof m !== 'object') return {};
  const out: Partial<DispatchModifiers> = {};
  if (typeof m.engine === 'string' && m.engine) out.engine = m.engine.replace(/^@/, '').toLowerCase();
  if (typeof m.strict === 'boolean') out.strict = m.strict;
  if (typeof m.planOnly === 'boolean') out.planOnly = m.planOnly;
  return out;
}

const snapshot = (s: DispatchSession): DispatchSession => structuredClone(s);
