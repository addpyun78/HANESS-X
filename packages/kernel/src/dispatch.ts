import { randomUUID } from 'node:crypto';
import {
  EngineRefSchema,
  INCOMPLETE_AGENT_MESSAGE,
  type Pipeline,
  type PipelineNode,
} from '@harness-x/protocol';
import type { LogRecord } from './event-log.js';
import {
  isSafePoint,
  PAUSE_TIMEOUT_QUESTION,
  PauseGate,
  type PausedInfo,
  type PauseReason,
  type StopKind,
  type StopResult,
} from './stop.js';

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
  /** T-101 2B.9 이어하기 실행이면 그 방식 (엔진 자체 재개면 노드별 엔진 세션 id) */
  resume?: DispatchResumeInfo;
}

export interface DispatchResumeInfo {
  /** engine: 엔진 자체 재개(예: claude --resume) / summary: 요약 컨텍스트로 새 엔진 세션 */
  mode: 'engine' | 'summary';
  /** 노드 id → 엔진 세션 id (mode engine) */
  resumeIds?: Record<string, string>;
}

/** T-101 2B 멈춘 세션 이어하기 요청 */
export interface DispatchResumeRequest {
  sessionId: string;
  /** 이름 또는 /명령 */
  agent: string;
  /** 이어하기 지시 (요약 컨텍스트 포함) */
  prompt: string;
  /** 2B.6 실행할 파이프라인 (기본: 시작할 때 버전을 넘긴다 — 없으면 지금 에이전트 파이프라인) */
  pipeline?: Pipeline;
  /** 2B.5 바꾼 엔진 (모든 role 노드에 적용) */
  engine?: string;
  resume: DispatchResumeInfo;
  /** session_resumed 기록에 붙일 것 (점검 결과·고른 선택지 등) */
  note?: Record<string, unknown>;
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
  /** T-101 2A.3 일시정지 요청 뒤 "지금 멈출까요?"까지 기다리는 시간 (기본 60초) */
  pauseTimeoutMs?: number;
  /**
   * T-101 2A.6 세션이 멈춘 직후 (정지 스냅샷: 파일 상태·현재 항목 interrupted).
   * 돌려준 필드는 session_paused 기록에 붙는다
   */
  onPaused?: (
    session: DispatchSession,
    ctx: { kind: StopKind; nodeId?: string; itemId?: string },
  ) => Record<string, unknown> | void;
  /** T-101 2B.6 실행 시작 직후 (버전 고정: agent.yaml·파이프라인·설정 스냅샷) */
  onCreated?: (session: DispatchSession, ctx: { agent: DispatchAgent; pipeline: Pipeline }) => void;
}

export type DispatchSessionStatus =
  'running' | 'paused' | 'completed' | 'incomplete' | 'failed' | 'error' | string;

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
  /** T-101 2A.2 일시정지 요청 뒤 안전한 지점을 기다리는 중 */
  pausing?: boolean;
  /** T-101 2A.6 멈춘 세션 (status 'paused') */
  paused?: PausedInfo;
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
}

interface Live {
  session: DispatchSession;
  done: Promise<DispatchSession>;
  queue: DispatchAgent[];
  abort: AbortController;
  /** T-101 2A 정지 요청 (abort 전에 정해 둔다 → 끝나면 paused로 기록) */
  stop?: { kind: StopKind; by: string; reason: PauseReason; nodeId?: string };
  pauseRequested?: { by: string; reason: PauseReason };
  /** 2A.3 안전한 지점 대기 (60초 타이머) */
  gate?: PauseGate;
  /** 2A.6 마지막으로 이벤트에 나온 체크리스트 항목 (멈추면 interrupted: true) */
  lastItemId?: string;
}

export class Dispatcher {
  private readonly opts: DispatcherOptions;
  private readonly live = new Map<string, Live>();
  private readonly stopAllHooks: (() => unknown)[] = [];
  private readonly idGen: () => string;
  private readonly now: () => Date;

  constructor(opts: DispatcherOptions) {
    this.opts = opts;
    this.idGen = opts.idGen ?? randomUUID;
    this.now = opts.now ?? (() => new Date());
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
    const sessionId = `dispatch-${this.idGen()}`;
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
    try {
      this.opts.onCreated?.(snapshot(session), { agent, pipeline: agent.pipeline });
    } catch {
      // 버전 고정 실패는 실행을 막지 않는다 (이어하기 때 지금 버전으로)
    }
    const abort = new AbortController();
    const live: Live = { session, queue: [], abort, done: Promise.resolve(session) };
    this.live.set(sessionId, live);
    live.done = this.execute(live, agent, pipeline);
    return snapshot(session);
  }

  /**
   * T-101 2B 멈춘 세션을 같은 세션 id로 이어서 실행한다 (session_resumed 기록).
   * 이 프로세스가 만든 세션이 아니어도(서버를 다시 켠 뒤) 이어할 수 있다.
   */
  resume(req: DispatchResumeRequest): DispatchSession {
    const prev = this.live.get(req.sessionId);
    if (prev && prev.session.status === 'running')
      throw new DispatchError('invalid_request', `이미 실행 중인 세션: ${req.sessionId}`);
    const agent = this.resolveAgent(req.agent);
    const modifiers: DispatchModifiers = {
      ...(prev?.session.modifiers ?? { strict: false, planOnly: false }),
      ...(req.engine ? { engine: req.engine } : {}),
    };
    this.checkEngine(modifiers.engine);
    const pipeline = applyModifiers(req.pipeline ?? agent.pipeline, modifiers);
    const from = prev?.session.paused;
    const session: DispatchSession = {
      sessionId: req.sessionId,
      agent: {
        name: agent.name,
        command: agent.command,
        displayName: agent.displayName,
        ...(agent.icon ? { icon: agent.icon } : {}),
      },
      prompt: prev?.session.prompt ?? req.prompt,
      modifiers,
      status: 'running',
      completedNodes: prev ? [...prev.session.completedNodes] : [],
      nodeCount: pipeline.nodes.length,
      progress: prev?.session.progress ?? 0,
      startedAt: prev?.session.startedAt ?? this.now().toISOString(),
      subagents: [],
    };
    this.emit(req.sessionId, 'session_resumed', {
      mode: req.resume.mode,
      ...(modifiers.engine ? { engine: modifiers.engine } : {}),
      ...(from ? { from } : {}),
      ...(req.note ?? {}),
    });
    const abort = new AbortController();
    const live: Live = { session, queue: [], abort, done: Promise.resolve(session) };
    this.live.set(req.sessionId, live);
    live.done = this.execute(live, agent, pipeline, req.prompt, req.resume);
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

  // ── T-101 2A.2 정지 3종 ───────────────────────────────────────
  /** ⏸ 일시정지: 안전한 지점(도구 실행이 끝난 뒤, 다음 AI 턴 전)에서 멈춘다 */
  pause(sessionId: string, by = 'user', reason: PauseReason = 'user'): StopResult {
    const live = this.mustLive(sessionId);
    if (live.session.status !== 'running') return { sessionId, kind: 'pause', state: 'not_running' };
    if (!live.pauseRequested) {
      live.pauseRequested = { by, reason };
      live.session.pausing = true;
      live.gate = new PauseGate({
        ...(this.opts.pauseTimeoutMs !== undefined ? { timeoutMs: this.opts.pauseTimeoutMs } : {}),
        // 2A.3 시간 안에 안전한 지점이 안 오면 "지금 멈출까요?" (카드가 [지금 멈추기] → POST …/stop)
        onTimeout: () =>
          live.session.status === 'running' &&
          this.emit(sessionId, 'pause_timeout', {
            title: PAUSE_TIMEOUT_QUESTION.title,
            body: PAUSE_TIMEOUT_QUESTION.body,
            choices: [...PAUSE_TIMEOUT_QUESTION.choices],
          }),
      });
      live.gate.request();
      this.emit(sessionId, 'pause_requested', { by, reason });
    }
    return { sessionId, kind: 'pause', state: 'pausing' };
  }

  /** ⏹ 지금 멈추기: 엔진 interrupt(→ 프로세스 그룹 종료). 끝나면 paused */
  async stopNow(
    sessionId: string,
    by = 'user',
    reason: PauseReason = 'user',
    kind: StopKind = 'stop-now',
  ): Promise<StopResult> {
    const live = this.mustLive(sessionId);
    if (live.session.status !== 'running') return { sessionId, kind, state: 'not_running' };
    this.halt(live, kind, by, reason);
    await live.done;
    return { sessionId, kind, state: 'paused' };
  }

  /** 전체 정지: 실행 중인 세션 전부를 지금 멈춘다 (+ 2A.5 진행 중인 설치 등 등록된 정지 훅) */
  async stopAll(by = 'user'): Promise<StopResult[]> {
    const running = [...this.live.values()].filter((l) => l.session.status === 'running');
    const [results] = await Promise.all([
      Promise.all(running.map((l) => this.stopNow(l.session.sessionId, by, 'user', 'stop-all'))),
      ...this.stopAllHooks.map((h) => Promise.resolve(h()).catch(() => undefined)),
    ]);
    return results;
  }

  /** 2A.5 전체 정지 때 함께 부를 훅 (예: 설치 관리자 InstallService.stopAll) */
  addStopAllHook(hook: () => unknown): () => void {
    this.stopAllHooks.push(hook);
    return () => {
      const i = this.stopAllHooks.indexOf(hook);
      if (i >= 0) this.stopAllHooks.splice(i, 1);
    };
  }

  /** 실행 중인 세션 수 (상단 바 [전체 정지] 표시 기준) */
  runningCount(): number {
    return [...this.live.values()].filter((l) => l.session.status === 'running').length;
  }

  // ── 내부 ───────────────────────────────────────────────────
  private mustLive(sessionId: string): Live {
    const live = this.live.get(sessionId);
    if (!live) throw new DispatchError('not_found', `세션 없음: ${sessionId}`);
    return live;
  }

  /** 정지 사유를 정해 두고 abort (실행기가 끝나면 execute가 paused로 기록) */
  private halt(live: Live, kind: StopKind, by: string, reason: PauseReason) {
    if (live.stop) return;
    live.stop = {
      kind,
      by,
      reason,
      ...(live.session.currentNode ? { nodeId: live.session.currentNode } : {}),
    };
    live.abort.abort();
  }

  private markPaused(live: Live) {
    live.gate?.dispose();
    const s = live.session;
    const stop = live.stop!;
    s.status = 'paused';
    s.pausing = false;
    s.currentNode = undefined;
    s.paused = { reason: stop.reason, at: this.now().toISOString(), by: stop.by };
    const itemId = live.lastItemId;
    let extra: Record<string, unknown> = {};
    try {
      extra =
        this.opts.onPaused?.(snapshot(s), {
          kind: stop.kind,
          ...(stop.nodeId ? { nodeId: stop.nodeId } : {}),
          ...(itemId ? { itemId } : {}),
        }) ?? {};
    } catch (err) {
      extra = { snapshotError: err instanceof Error ? err.message : String(err) };
    }
    this.emit(s.sessionId, 'session_paused', {
      kind: stop.kind,
      paused: s.paused,
      progress: s.progress,
      ...(stop.nodeId ? { nodeId: stop.nodeId } : {}),
      ...(itemId ? { item: { id: itemId, interrupted: true } } : {}),
      ...extra,
    });
  }

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

  private async execute(
    live: Live,
    first: DispatchAgent,
    firstPipeline: Pipeline,
    firstPrompt?: string,
    resume?: DispatchResumeInfo,
  ): Promise<DispatchSession> {
    const s = live.session;
    let agent = first;
    let pipeline = firstPipeline;
    let prompt = firstPrompt ?? s.prompt;
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
          onEvent: (rec) => this.track(live, rec, p),
          signal: live.abort.signal,
          ...(resume && !p ? { resume } : {}),
        });
        if (live.stop) {
          this.markPaused(live);
          break;
        }
        live.gate?.dispose();
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
      if (live.stop) this.markPaused(live);
      else this.finish(s, 'error', err instanceof Error ? err.message : String(err));
    }
    return s;
  }

  /** prefix: 서브에이전트 노드는 '<에이전트>/<노드>'로 센다 (본 파이프라인과 id가 겹쳐도 따로) */
  private track(live: Live, rec: LogRecord, prefix: string) {
    const s = live.session;
    if (typeof rec.itemId === 'string') live.lastItemId = rec.itemId;
    // 2A.3 안전한 지점(도구 실행이 끝난 뒤·다음 AI 턴 전)에서 일시정지 요청을 실행
    if (live.pauseRequested && isSafePoint(rec) && live.gate?.atSafePoint()) {
      if (typeof rec.nodeId === 'string' && !s.currentNode) s.currentNode = prefix + rec.nodeId;
      this.halt(live, 'pause', live.pauseRequested.by, live.pauseRequested.reason);
    }
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
