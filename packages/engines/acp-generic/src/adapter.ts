import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { stripCredentialEnv } from '@harness-x/kernel';
import type {
  EngineAdapter,
  EngineCapabilities,
  EngineErrorCode,
  EngineRun,
  EngineRunOptions,
  HarnessEvent,
  McpServerRef,
} from '@harness-x/protocol';
import { AcpEventMapper, mapStopReason, type HarnessEventBody } from './events.js';
import { AsyncQueue } from './queue.js';

/**
 * T-018 ACP 범용 어댑터.
 * ACP 에이전트(claude-agent-acp, codex-acp, gemini --experimental-acp 등)를 자식 프로세스로 띄우고
 * stdio(ndjson JSON-RPC)로 initialize → session/new(또는 session/load) → session/prompt 를 보낸다.
 * session/update 알림은 HarnessEvent로 정규화한다.
 */

export const HARNESS_CLIENT_INFO: acp.Implementation = { name: 'harness-x', version: '0.1.0' };

/** 권한 요청 처리기에 넘기는 실행 문맥 */
export interface PermissionContext {
  sessionId: string;
  engineId: string;
  itemId?: string;
  /** 승인 이벤트 등 HarnessEvent를 run 스트림에 낸다 */
  emit(body: HarnessEventBody): void;
  /** 하네스 사용자(UI)의 승인 응답을 기다린다. optionId=null 이면 취소 */
  waitApproval(approvalId: string, signal: AbortSignal): Promise<string | null>;
  signal: AbortSignal;
}

export type PermissionHandler = (
  req: acp.RequestPermissionRequest,
  ctx: PermissionContext,
) => Promise<acp.RequestPermissionResponse>;

export interface AcpEngineConfig {
  /** 예: claude-code (ACP), codex (ACP) */
  id: string;
  displayName: string;
  /** ACP 에이전트 실행 파일 (예: claude-agent-acp) */
  command: string;
  args?: string[];
  /** opts.env 위에 덧붙일 env */
  env?: Record<string, string>;
  /** session/request_permission 처리 (기본: 거부 없이 cancelled) */
  permission?: PermissionHandler;
  /** 턴 종료 후 에이전트 프로세스가 스스로 끝나길 기다리는 시간 (기본 2초, 이후 SIGTERM) */
  shutdownGraceMs?: number;
}

export interface AcpEngineRun extends EngineRun {
  /** approval_request 이벤트에 대한 응답. optionId=null 이면 취소. 대기 중인 승인이 없으면 false */
  respondApproval(approvalId: string, optionId: string | null): boolean;
  /** initialize 응답 (에이전트 정보·능력) */
  initializeResponse(): acp.InitializeResponse | undefined;
}

class AcpRunError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function toAcpMcpServers(refs: McpServerRef[] = []): acp.McpServer[] {
  return refs.map((r) =>
    r.url
      ? {
          type: 'http' as const,
          name: r.name,
          url: r.url,
          headers: Object.entries(r.headers ?? {}).map(([name, value]) => ({ name, value })),
        }
      : {
          name: r.name,
          command: r.command ?? '',
          args: r.args ?? [],
          env: Object.entries(r.env ?? {}).map(([name, value]) => ({ name, value })),
        },
  );
}

/** JSON-RPC 오류 → 엔진 오류 코드 */
export function classifyAcpError(err: unknown): AcpRunError {
  if (err instanceof AcpRunError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof acp.RequestError) {
    if (err.code === -32000) return new AcpRunError('auth_required', msg);
    if (err.code === -32800) return new AcpRunError('invalid_request', `cancelled: ${msg}`);
    if (err.code === -32601 || err.code === -32602 || err.code === -32600)
      return new AcpRunError('invalid_request', msg);
    if (/rate.?limit/i.test(msg)) return new AcpRunError('rate_limited', msg, true);
    if (/quota|usage limit/i.test(msg)) return new AcpRunError('quota_exceeded', msg);
    return new AcpRunError('unknown', msg);
  }
  return new AcpRunError('engine_crashed', msg);
}

export class AcpEngine implements EngineAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: EngineCapabilities = {
    nativeStopHook: false,
    resume: true,
    mcp: true,
    interrupt: true,
  };

  constructor(readonly config: AcpEngineConfig) {
    this.id = config.id;
    this.displayName = config.displayName;
  }

  run(opts: EngineRunOptions): AcpEngineRun {
    const cfg = this.config;
    const engineId = this.id;
    const queue = new AsyncQueue<HarnessEvent>();
    const ac = new AbortController();
    const approvals = new Map<string, (optionId: string | null) => void>();
    let engineSessionId: string | undefined = opts.resumeId;
    let initRes: acp.InitializeResponse | undefined;
    let interrupted = false;
    /** session/load 중 에이전트가 다시 보내는 과거 기록은 새 이벤트로 내지 않는다 */
    let replaying = false;
    let mapper = new AcpEventMapper();

    const emit = (body: HarnessEventBody) =>
      queue.push({
        id: randomUUID(),
        ts: new Date().toISOString(),
        sessionId: opts.sessionId,
        engineId,
        ...(opts.itemId ? { itemId: opts.itemId } : {}),
        ...body,
      } as HarnessEvent);

    const env = { ...(opts.env ?? stripCredentialEnv(process.env)), ...(cfg.env ?? {}) };
    let child: ChildProcess;
    try {
      child = spawn(cfg.command, cfg.args ?? [], {
        cwd: opts.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      return failedRun(emit, queue, classifyAcpError(err));
    }
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-4000);
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>(
      (resolve) => {
        child.once('error', (error) => resolve({ code: null, signal: null, error }));
        // close: stdio까지 닫힌 뒤 (마지막 응답을 다 읽은 다음)
        child.once('close', (code, signal) => resolve({ code, signal }));
      },
    );

    const permissionCtx: PermissionContext = {
      sessionId: opts.sessionId,
      engineId,
      ...(opts.itemId ? { itemId: opts.itemId } : {}),
      emit,
      signal: ac.signal,
      waitApproval: (approvalId, signal) =>
        new Promise<string | null>((resolve) => {
          const done = (v: string | null) => {
            approvals.delete(approvalId);
            resolve(v);
          };
          approvals.set(approvalId, done);
          if (signal.aborted) done(null);
          else signal.addEventListener('abort', () => done(null), { once: true });
        }),
    };
    const permission: PermissionHandler =
      cfg.permission ??
      (async () => ({ outcome: { outcome: 'cancelled' } }) as acp.RequestPermissionResponse);

    const app = acp
      .client({ name: HARNESS_CLIENT_INFO.name })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        if (replaying || (engineSessionId && params.sessionId !== engineSessionId)) return;
        for (const b of mapper.map(params.update)) emit(b);
      })
      .onRequest(acp.methods.client.session.requestPermission, ({ params, signal }) => {
        const both = AbortSignal.any([signal, ac.signal]);
        return permission(params, { ...permissionCtx, signal: both });
      });

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
    );
    const conn = app.connect(stream);
    const agent = conn.agent;

    const main = async (): Promise<acp.PromptResponse> => {
      initRes = await agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: HARNESS_CLIENT_INFO,
      });
      const mcpServers = toAcpMcpServers(opts.mcpServers);
      if (opts.resumeId) {
        if (!initRes.agentCapabilities?.loadSession)
          throw new AcpRunError(
            'invalid_request',
            `${engineId}: 에이전트가 session/load를 지원하지 않습니다`,
          );
        replaying = true;
        try {
          await agent.request(acp.methods.agent.session.load, {
            sessionId: opts.resumeId,
            cwd: opts.cwd,
            mcpServers,
          });
        } finally {
          replaying = false;
        }
        engineSessionId = opts.resumeId;
      } else {
        const res = await agent.request(acp.methods.agent.session.new, { cwd: opts.cwd, mcpServers });
        engineSessionId = res.sessionId;
      }
      if (interrupted) return { stopReason: 'cancelled' };
      mapper = new AcpEventMapper();
      return agent.request(acp.methods.agent.session.prompt, {
        sessionId: engineSessionId,
        prompt: [{ type: 'text', text: opts.prompt }],
      });
    };

    const crashed = exited.then(async (e) => {
      // 마지막 응답 메시지가 처리될 틈을 준다
      await new Promise((r) => setTimeout(r, 50));
      throw new AcpRunError(
        'engine_crashed',
        e.error
          ? `${cfg.command} 실행 실패: ${e.error.message}`
          : `ACP 에이전트가 턴 도중 종료됨 (code ${e.code ?? e.signal})${stderr ? `: ${stderr.trim().slice(-500)}` : ''}`,
      );
    });

    const interrupt = async () => {
      if (interrupted) return;
      interrupted = true;
      ac.abort();
      for (const done of [...approvals.values()]) done(null);
      if (engineSessionId) {
        try {
          await agent.notify(acp.methods.agent.session.cancel, { sessionId: engineSessionId });
        } catch {
          // 연결이 이미 닫혔으면 무시
        }
      }
      // 에이전트가 cancelled로 응답하지 않으면 grace 후 종료
      const t = setTimeout(() => child.kill('SIGTERM'), cfg.shutdownGraceMs ?? 2000);
      void exited.then(() => clearTimeout(t));
    };
    if (opts.signal) {
      if (opts.signal.aborted) void interrupt();
      else opts.signal.addEventListener('abort', () => void interrupt(), { once: true });
    }

    const done = (async () => {
      try {
        const res = await Promise.race([main(), crashed]);
        if (mapper.fullText) emit({ type: 'assistant_text', text: mapper.fullText, partial: false });
        emit({ type: 'turn_end', reason: interrupted ? 'interrupted' : mapStopReason(res.stopReason) });
      } catch (err) {
        if (interrupted) emit({ type: 'turn_end', reason: 'interrupted' });
        else {
          const e = classifyAcpError(err);
          emit({ type: 'error', code: e.code, message: e.message, retryable: e.retryable });
          emit({ type: 'turn_end', reason: 'error' });
        }
      } finally {
        for (const d of [...approvals.values()]) d(null);
        queue.close();
        conn.close();
        child.stdin?.end();
      }
      const t = setTimeout(() => child.kill('SIGTERM'), cfg.shutdownGraceMs ?? 2000);
      const e = await exited;
      clearTimeout(t);
      return { exitCode: e.code };
    })();
    crashed.catch(() => undefined);

    return {
      events: queue,
      engineSessionId: () => engineSessionId,
      interrupt,
      done,
      respondApproval: (approvalId, optionId) => {
        const d = approvals.get(approvalId);
        if (!d) return false;
        d(optionId);
        return true;
      },
      initializeResponse: () => initRes,
    };
  }
}

function failedRun(
  emit: (b: HarnessEventBody) => void,
  queue: AsyncQueue<HarnessEvent>,
  e: AcpRunError,
): AcpEngineRun {
  emit({ type: 'error', code: e.code, message: e.message, retryable: e.retryable });
  emit({ type: 'turn_end', reason: 'error' });
  queue.close();
  return {
    events: queue,
    engineSessionId: () => undefined,
    interrupt: async () => undefined,
    done: Promise.resolve({ exitCode: null }),
    respondApproval: () => false,
    initializeResponse: () => undefined,
  };
}

export function createAcpEngine(config: AcpEngineConfig): AcpEngine {
  return new AcpEngine(config);
}
