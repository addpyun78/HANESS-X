import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { EngineErrorCode, EngineRun, HarnessEvent, PermissionMode } from '@harness-x/protocol';
import type { HookBus } from './hooks.js';

/**
 * 하네스 자체 도구 루프 (API 엔진용)
 * 모델 API(OpenAI 호환·Anthropic·Gemini 등)는 ModelClient로 추상화하고,
 * 루프·도구 실행·훅 연동은 하네스가 소유한다.
 */

// ── 모델 클라이언트 추상화 ───────────────────────────────────────
export interface ToolCallRequest {
  /** 모델이 준 호출 ID (없으면 클라이언트가 만든다) */
  id: string;
  name: string;
  /** 파싱된 인자 (JSON 파싱 실패 시 원문 문자열) */
  arguments: unknown;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (object) */
  parameters: Record<string, unknown>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCallRequest[];
  usage?: ModelUsage;
  /** 공급자 종료 사유 원문 (stop, tool_calls, end_turn …) */
  finishReason?: string;
}

export interface ModelRequest {
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
  /** 스트리밍 텍스트 조각 */
  onText?(delta: string): void;
}

export interface ModelClient {
  complete(req: ModelRequest): Promise<ModelTurn>;
}

/** 모델 API 오류 (HTTP 상태 포함) */
export class ModelApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ModelApiError';
  }
}

// ── 도구 ─────────────────────────────────────────────────────────
export interface ToolRunContext {
  cwd: string;
  signal?: AbortSignal;
  /** 파일 변경을 file_change 이벤트로 알린다 */
  fileChanged(path: string, change: 'create' | 'modify' | 'delete'): void;
}

export interface AgentTool extends ToolSpec {
  /** 쓰기 도구 (read-only 권한에서 제외) */
  mutates?: boolean;
  run(input: unknown, ctx: ToolRunContext): Promise<unknown> | unknown;
}

/** 워크스페이스 밖을 가리키면 예외. 반환: 절대 경로 */
export function resolveInWorkspace(cwd: string, p: unknown): string {
  if (typeof p !== 'string' || !p.trim()) throw new Error('path가 필요합니다');
  const root = realpathSync(resolve(cwd));
  const abs = resolve(root, p);
  const check = (target: string) => {
    const rel = relative(root, target);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return;
    throw new Error(`워크스페이스 밖 경로 금지: ${p}`);
  };
  check(abs);
  // 심볼릭 링크로 빠져나가는 것 방지: 존재하는 가장 가까운 조상의 실제 경로 검사
  let probe = abs;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  check(realpathSync(probe));
  return abs;
}

const MAX_READ_BYTES = 256 * 1024;

function argsObj(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

/** 기본 워크스페이스 도구: read_file, list_dir, write_file (모두 cwd 안으로 한정) */
export function workspaceTools(): AgentTool[] {
  return [
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file inside the workspace. path is relative to the workspace root.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'file path relative to workspace root' } },
        required: ['path'],
      },
      run(input, ctx) {
        const p = argsObj(input).path;
        const abs = resolveInWorkspace(ctx.cwd, p);
        if (!statSync(abs).isFile()) throw new Error(`파일이 아닙니다: ${String(p)}`);
        const buf = readFileSync(abs);
        const text = buf.subarray(0, MAX_READ_BYTES).toString('utf8');
        return buf.length > MAX_READ_BYTES ? `${text}\n…(truncated, ${buf.length} bytes)` : text;
      },
    },
    {
      name: 'list_dir',
      description: 'List entries of a directory inside the workspace. Directories end with "/".',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'directory relative to workspace root (default ".")' },
        },
      },
      run(input, ctx) {
        const p = argsObj(input).path;
        const abs = resolveInWorkspace(ctx.cwd, typeof p === 'string' && p.trim() ? p : '.');
        return readdirSync(abs, { withFileTypes: true })
          .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
          .sort();
      },
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a UTF-8 text file inside the workspace (parent folders are created).',
      mutates: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'file path relative to workspace root' },
          content: { type: 'string', description: 'full file content' },
        },
        required: ['path', 'content'],
      },
      run(input, ctx) {
        const a = argsObj(input);
        if (typeof a.content !== 'string') throw new Error('content(문자열)가 필요합니다');
        const abs = resolveInWorkspace(ctx.cwd, a.path);
        const existed = existsSync(abs);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, a.content);
        const rel = relative(realpathSync(resolve(ctx.cwd)), abs)
          .split(sep)
          .join('/');
        ctx.fileChanged(rel, existed ? 'modify' : 'create');
        return `wrote ${Buffer.byteLength(a.content)} bytes to ${rel}`;
      },
    },
  ];
}

// ── 루프 ─────────────────────────────────────────────────────────
export const DEFAULT_MAX_ITERATIONS = 30;

export interface AgentLoopOptions {
  client: ModelClient;
  sessionId: string;
  cwd: string;
  prompt: string;
  engineId?: string;
  itemId?: string;
  system?: string;
  /** 이전 대화 (system 제외) — 그 뒤에 prompt를 user 메시지로 붙인다 */
  history?: ChatMessage[];
  /** 기본 workspaceTools() */
  tools?: AgentTool[];
  /** read-only면 mutates 도구 제외 */
  permission?: PermissionMode;
  /** tool.before(차단형)·tool.after(알림형) 훅 */
  hooks?: HookBus;
  /** 모델 호출 최대 횟수 (기본 30) */
  maxIterations?: number;
  signal?: AbortSignal;
}

type Distribute<E> = E extends HarnessEvent
  ? Omit<E, 'id' | 'ts' | 'sessionId' | 'engineId' | 'itemId'>
  : never;
type EventInput = Distribute<HarnessEvent>;

const TOOL_RESULT_MAX_CHARS = 64 * 1024;

function stringifyOutput(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  return s.length > TOOL_RESULT_MAX_CHARS ? `${s.slice(0, TOOL_RESULT_MAX_CHARS)}\n…(truncated)` : s;
}

/** 모델 API 오류 → 엔진 오류 코드 */
export function classifyModelError(err: unknown): { code: EngineErrorCode; retryable: boolean } {
  const status = err instanceof ModelApiError ? err.status : undefined;
  const msg = err instanceof Error ? err.message : String(err);
  if (status === 401 || status === 403) return { code: 'auth_required', retryable: false };
  if (status === 402 || /insufficient_quota|exceeded your current quota|credit balance/i.test(msg))
    return { code: 'quota_exceeded', retryable: false };
  if (status === 429) return { code: 'rate_limited', retryable: true };
  if (status !== undefined && status >= 400 && status < 500)
    return { code: 'invalid_request', retryable: false };
  if (status !== undefined && status >= 500) return { code: 'unknown', retryable: true };
  if (/^network:|ECONNREFUSED|fetch failed|ENOTFOUND|ETIMEDOUT/i.test(msg))
    return { code: 'network', retryable: true };
  return { code: 'unknown', retryable: false };
}

/**
 * 도구 루프: 모델 호출 → tool_calls마다 tool.before(차단형) → 실행 → tool.after(알림형) → 결과를 모델에 반환 → 반복.
 * 도구 호출 없이 답하면 turn_end completed, maxIterations(기본 30)번 모델을 불러도 끝나지 않으면 turn_end max_turns.
 */
export async function* runAgentLoop(opts: AgentLoopOptions): AsyncGenerator<HarnessEvent> {
  const maxIter = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const tools = (opts.tools ?? workspaceTools()).filter(
    (t) => !(opts.permission === 'read-only' && t.mutates),
  );
  const byName = new Map(tools.map((t) => [t.name, t]));
  const specs: ToolSpec[] = tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push(...(opts.history ?? []), { role: 'user', content: opts.prompt });

  const scope = {
    sessionId: opts.sessionId,
    ...(opts.engineId ? { engineId: opts.engineId } : {}),
    ...(opts.itemId ? { itemId: opts.itemId } : {}),
  };
  const ev = (e: EventInput): HarnessEvent =>
    ({ id: randomUUID(), ts: new Date().toISOString(), ...scope, ...e }) as HarnessEvent;
  const hookCtx = { ...scope, cwd: opts.cwd };
  const aborted = () => opts.signal?.aborted === true;

  for (let iter = 0; iter < maxIter; iter++) {
    if (aborted()) {
      yield ev({ type: 'turn_end', reason: 'interrupted' });
      return;
    }
    // 스트리밍 텍스트 조각은 모델 호출이 끝난 뒤 순서대로 방출한다
    const partials: string[] = [];
    let turn: ModelTurn;
    try {
      turn = await opts.client.complete({
        messages: [...messages],
        tools: specs,
        signal: opts.signal,
        onText: (d) => partials.push(d),
      });
    } catch (err) {
      for (const p of partials) yield ev({ type: 'assistant_text', text: p, partial: true });
      if (aborted()) {
        yield ev({ type: 'turn_end', reason: 'interrupted' });
        return;
      }
      const c = classifyModelError(err);
      yield ev({
        type: 'error',
        code: c.code,
        message: err instanceof Error ? err.message : String(err),
        retryable: c.retryable,
      });
      yield ev({ type: 'turn_end', reason: 'error' });
      return;
    }
    for (const p of partials) yield ev({ type: 'assistant_text', text: p, partial: true });
    if (turn.usage) yield ev({ type: 'usage', ...turn.usage });
    if (turn.text) yield ev({ type: 'assistant_text', text: turn.text, partial: false });

    messages.push({
      role: 'assistant',
      content: turn.text,
      ...(turn.toolCalls.length ? { toolCalls: turn.toolCalls } : {}),
    });
    if (!turn.toolCalls.length) {
      yield ev({ type: 'turn_end', reason: 'completed' });
      return;
    }

    for (const call of turn.toolCalls) {
      let input: unknown = call.arguments;
      yield ev({ type: 'tool_call', callId: call.id, tool: call.name, input });
      const changes: { path: string; change: 'create' | 'modify' | 'delete' }[] = [];
      let ok = false;
      let output: unknown;
      let content: string;
      const gate = opts.hooks
        ? await opts.hooks.runBlocking('tool.before', { ...hookCtx, callId: call.id, tool: call.name, input })
        : undefined;
      if (gate && gate.decision !== 'allow') {
        output = { denied: true, decision: gate.decision, reason: gate.reason ?? '', hookId: gate.hookId };
        content = `Tool call denied by harness (${gate.decision}): ${gate.reason ?? 'no reason given'}`;
      } else {
        if (gate?.patch) input = applyPatch(input, gate.patch);
        const tool = byName.get(call.name);
        try {
          if (!tool) throw new Error(`알 수 없는 도구: ${call.name}`);
          output = await tool.run(input, {
            cwd: opts.cwd,
            signal: opts.signal,
            fileChanged: (path, change) => changes.push({ path, change }),
          });
          ok = true;
          content = stringifyOutput(output);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          output = { error: message };
          content = `Error: ${message}`;
        }
      }
      for (const c of changes) yield ev({ type: 'file_change', ...c });
      yield ev({ type: 'tool_result', callId: call.id, ok, output });
      if (opts.hooks)
        void opts.hooks.emit('tool.after', {
          ...hookCtx,
          callId: call.id,
          tool: call.name,
          input,
          ok,
          output,
        });
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
    }
  }
  yield ev({ type: 'turn_end', reason: 'max_turns' });
}

const CTX_KEYS = new Set(['sessionId', 'engineId', 'itemId', 'cwd', 'callId', 'tool', 'input']);

/** tool.before patch 적용: patch.input은 입력 전체 교체, 그 밖의 키(path 등)는 입력 필드 덮어쓰기 */
function applyPatch(input: unknown, patch: Record<string, unknown>): unknown {
  let next = 'input' in patch ? patch.input : input;
  const fields = Object.entries(patch).filter(([k]) => !CTX_KEYS.has(k));
  if (fields.length && next && typeof next === 'object')
    next = { ...(next as object), ...Object.fromEntries(fields) };
  return next;
}

// ── EngineRun 어댑터 ─────────────────────────────────────────────
/**
 * 이벤트 소스를 EngineRun으로 감싼다. 소비자가 없어도 백그라운드로 끝까지 진행하며
 * 이벤트는 버퍼에 쌓였다가 events에서 차례로 나온다(단일 소비자). interrupt()는 signal을 abort한다.
 */
export function toEngineRun(
  make: (signal: AbortSignal) => AsyncIterable<HarnessEvent>,
  opts: { signal?: AbortSignal; engineSessionId?: () => string | undefined } = {},
): EngineRun {
  const ac = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener('abort', () => ac.abort(), { once: true });
  }
  const buf: HarnessEvent[] = [];
  let finished = false;
  let wake: (() => void) | undefined;
  const notify = () => {
    const w = wake;
    wake = undefined;
    w?.();
  };
  const done = (async () => {
    let exitCode = 0;
    try {
      for await (const e of make(ac.signal)) {
        buf.push(e);
        if (e.type === 'turn_end' && e.reason === 'error') exitCode = 1;
        notify();
      }
    } catch {
      exitCode = 1;
    } finally {
      finished = true;
      notify();
    }
    return { exitCode };
  })();
  async function* events(): AsyncGenerator<HarnessEvent> {
    for (;;) {
      const next = buf.shift();
      if (next) {
        yield next;
        continue;
      }
      if (finished) return;
      await new Promise<void>((r) => (wake = r));
    }
  }
  return {
    events: events(),
    engineSessionId: opts.engineSessionId ?? (() => undefined),
    interrupt: async () => {
      ac.abort();
      await done;
    },
    done,
  };
}
