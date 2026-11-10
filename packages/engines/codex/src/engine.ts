import {
  AsyncQueue,
  eventFactory,
  killGroup,
  readLines,
  runLineProcess,
  spawnGroup,
  type EventBody,
  type LineRun,
} from '@harness-x/kernel';
import type {
  EngineAdapter,
  EngineRun,
  EngineRunOptions,
  HarnessEvent,
  UsageEvent,
} from '@harness-x/protocol';
import { APP_SERVER_ARGS, buildExecArgs, threadParams } from './args.js';
import { CodexAppServerMapper, quotaRatioFromRateLimits, rateLimitsToUsage } from './app-server.js';
import { classifyCodexError } from './errors.js';
import { CodexExecParser } from './exec-parser.js';
import { JsonRpcClient, JsonRpcError } from './jsonrpc.js';

export const CODEX_ENGINE_ID = 'codex';
const CLIENT_INFO = { name: 'harness-x', title: 'HARNESS-X', version: '0.0.0' };

export type CodexTransport = 'app-server' | 'exec' | 'auto';

export interface CodexEngineOptions {
  /** 실행 파일 (기본 codex) */
  command?: string;
  /** codex 인자 앞에 붙일 인자 (테스트용 가짜 서버 스크립트 등) */
  prefixArgs?: string[];
  /** auto(기본): app-server 핸드셰이크 실패 시 exec --json으로 폴백 */
  transport?: CodexTransport;
  /** JSON-RPC 요청 제한 시간 (기본 30초) */
  requestTimeoutMs?: number;
  killGraceMs?: number;
}

export interface CodexRun extends EngineRun {
  /** 실제로 쓴 경로 */
  transport(): 'app-server' | 'exec';
}

export interface QuotaOptions {
  sessionId: string;
  cwd: string;
  env?: Record<string, string | undefined>;
}

export type CodexEngine = Omit<EngineAdapter, 'run'> & {
  run(opts: EngineRunOptions): CodexRun;
  /** 15.3 account/rateLimits/read로 쿼터 조회 (모델 호출 없음) → usage 이벤트 */
  quota(opts: QuotaOptions): Promise<UsageEvent>;
};

function errorBody(err: unknown): EventBody {
  const message = err instanceof Error ? err.message : String(err);
  const c = classifyCodexError(message);
  return { type: 'error', code: c.code, message, retryable: c.retryable };
}

export function createCodexEngine(o: CodexEngineOptions = {}): CodexEngine {
  const command = o.command ?? 'codex';
  const prefix = o.prefixArgs ?? [];
  const timeout = o.requestTimeoutMs ?? 30_000;

  /** app-server 자식 + 초기화된 JSON-RPC 클라이언트 */
  async function openAppServer(cwd: string, env: Record<string, string | undefined> | undefined) {
    const child = spawnGroup(command, [...prefix, ...APP_SERVER_ARGS], {
      cwd,
      env: env ?? process.env,
      stdin: true,
    });
    const spawnFailed = new Promise<never>((_, reject) => child.once('error', reject));
    spawnFailed.catch(() => {});
    if (!child.stdout || !child.stdin) throw new Error('app-server stdio 없음');
    child.stdin.on('error', () => {});
    const client = new JsonRpcClient(child.stdout, child.stdin);
    const stderr: string[] = [];
    if (child.stderr)
      void (async () => {
        for await (const l of readLines(child.stderr!)) if (stderr.length < 100) stderr.push(l);
      })();
    child.once('close', () =>
      client.close(new Error(`app-server 종료${stderr.length ? `: ${stderr.slice(-3).join(' ')}` : ''}`)),
    );
    try {
      await Promise.race([client.initialize(CLIENT_INFO, timeout), spawnFailed]);
    } catch (err) {
      await killGroup(child, 200);
      throw err;
    }
    return { child, client, stderr };
  }

  function runExec(opts: EngineRunOptions, event: (b: EventBody) => HarnessEvent): LineRun {
    return runLineProcess({
      command,
      args: [...prefix, ...buildExecArgs(opts)],
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      signal: opts.signal,
      killGraceMs: o.killGraceMs,
      event,
      parser: new CodexExecParser(),
    });
  }

  function run(opts: EngineRunOptions): CodexRun {
    const event = eventFactory({ sessionId: opts.sessionId, engineId: CODEX_ENGINE_ID, itemId: opts.itemId });
    const transport = o.transport ?? 'auto';
    if (transport === 'exec') return { ...runExec(opts, event), transport: () => 'exec' };

    const q = new AsyncQueue<HarnessEvent>();
    const mapper = new CodexAppServerMapper();
    let used: 'app-server' | 'exec' = 'app-server';
    let execRun: LineRun | undefined;
    let server: Awaited<ReturnType<typeof openAppServer>> | undefined;
    let interrupted = false;
    let ended = false;
    const push = (bodies: EventBody[]) => {
      for (const b of bodies) {
        if (ended) return;
        q.push(event(b));
        if (b.type === 'turn_end') ended = true;
      }
    };

    const done = (async (): Promise<{ exitCode: number | null }> => {
      try {
        server = await openAppServer(opts.cwd, opts.env);
      } catch (err) {
        if (interrupted) {
          push([{ type: 'turn_end', reason: 'interrupted' }]);
          q.end();
          return { exitCode: null };
        }
        if (transport === 'auto') {
          used = 'exec';
          execRun = runExec(opts, event);
          for await (const e of execRun.events) q.push(e);
          q.end();
          return execRun.done;
        }
        push([errorBody(err), { type: 'turn_end', reason: 'error' }]);
        q.end();
        return { exitCode: null };
      }
      const { child, client } = server;
      const closed = new Promise<number | null>((r) => {
        if (child.exitCode !== null || child.signalCode !== null) r(child.exitCode);
        else child.once('close', (code) => r(code));
      });
      // 승인은 묻지 않도록 approvalPolicy: never로 시작하지만, 혹시 오면 거절한다
      client.onServerRequest = (req) => {
        if (req.method.endsWith('/requestApproval')) return { decision: 'decline' };
        throw new JsonRpcError(-32601, `unsupported server request: ${req.method}`);
      };
      const turnDone = new Promise<void>((resolve) => {
        client.onNotification((n) => {
          push(mapper.handle(n));
          if (mapper.ended) resolve();
        });
        void closed.then(() => resolve());
      });
      try {
        try {
          mapper.quotaRatio = quotaRatioFromRateLimits(
            await client.request('account/rateLimits/read', undefined, 5000),
          );
        } catch {
          /* 쿼터 조회 실패는 턴을 막지 않는다 (인증 문제면 턴에서 오류로 나온다) */
        }
        const params = threadParams(opts);
        const th = await client.request<{ thread?: { id?: string } }>(
          opts.resumeId ? 'thread/resume' : 'thread/start',
          params,
          timeout,
        );
        mapper.threadId = th?.thread?.id ?? mapper.threadId ?? opts.resumeId;
        const turn = await client.request<{ turn?: { id?: string } }>(
          'turn/start',
          { threadId: mapper.threadId, input: [{ type: 'text', text: opts.prompt, text_elements: [] }] },
          timeout,
        );
        mapper.turnId = turn?.turn?.id ?? mapper.turnId;
        await turnDone;
      } catch (err) {
        if (!interrupted) push([errorBody(err), { type: 'turn_end', reason: 'error' }]);
      }
      if (interrupted) push([{ type: 'turn_end', reason: 'interrupted' }]);
      if (!ended)
        push([
          {
            type: 'error',
            code: 'engine_crashed',
            message: `app-server가 turn/completed 없이 종료됨${server.stderr.length ? `: ${server.stderr.slice(-3).join(' ')}` : ''}`,
          },
          { type: 'turn_end', reason: 'error' },
        ]);
      q.end();
      client.close();
      await killGroup(child, o.killGraceMs ?? 1000);
      return { exitCode: await closed };
    })();

    const interrupt = async () => {
      if (execRun) return execRun.interrupt();
      if (interrupted) return;
      interrupted = true;
      const s = server;
      if (!s) return;
      if (mapper.threadId && mapper.turnId && !mapper.ended) {
        await s.client
          .request('turn/interrupt', { threadId: mapper.threadId, turnId: mapper.turnId }, 500)
          .catch(() => {});
      }
      s.client.close(new Error('interrupted'));
      await killGroup(s.child, o.killGraceMs ?? 1000);
    };
    if (opts.signal) {
      if (opts.signal.aborted) void interrupt();
      else opts.signal.addEventListener('abort', () => void interrupt(), { once: true });
    }

    return {
      events: q,
      engineSessionId: () => (execRun ? execRun.engineSessionId() : mapper.threadId),
      interrupt,
      done,
      transport: () => used,
    };
  }

  async function quota(qo: QuotaOptions): Promise<UsageEvent> {
    const event = eventFactory({ sessionId: qo.sessionId, engineId: CODEX_ENGINE_ID });
    const { child, client } = await openAppServer(qo.cwd, qo.env);
    try {
      const res = await client.request('account/rateLimits/read', undefined, timeout);
      return event(rateLimitsToUsage(res)) as UsageEvent;
    } finally {
      client.close();
      await killGroup(child, 200);
    }
  }

  return {
    id: CODEX_ENGINE_ID,
    displayName: 'Codex',
    capabilities: { nativeStopHook: false, resume: true, mcp: true, interrupt: true },
    run,
    quota,
  };
}

export const codexEngine = createCodexEngine();
