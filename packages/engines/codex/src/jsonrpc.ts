import { readLines, tryJson } from '@harness-x/kernel';
import type { Readable, Writable } from 'node:stream';

/**
 * 15.1 codex app-server stdio JSON-RPC 클라이언트
 * 한 줄 = 메시지 하나 (JSON-RPC 2.0 형태, codex는 "jsonrpc" 필드를 생략한다)
 */

export type RpcId = number | string;
export interface RpcNotification {
  method: string;
  params?: unknown;
}
export interface RpcServerRequest extends RpcNotification {
  id: RpcId;
}

export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

export interface ClientInfo {
  name: string;
  title: string | null;
  version: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export class JsonRpcClient {
  private nextId = 1;
  private pending = new Map<RpcId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private notificationHandlers: ((n: RpcNotification) => void)[] = [];
  private closed: Error | undefined;
  /** 서버 → 클라이언트 요청 처리 (승인 요청 등). 기본: method not found */
  onServerRequest: (req: RpcServerRequest) => Promise<unknown> | unknown = (req) => {
    throw new JsonRpcError(-32601, `unsupported server request: ${req.method}`);
  };
  /** 받은 원본 메시지 (녹화용) */
  onMessage?: (msg: unknown) => void;
  readonly finished: Promise<void>;

  constructor(
    input: Readable,
    private readonly output: Writable,
  ) {
    this.finished = (async () => {
      for await (const line of readLines(input)) this.receive(line);
      this.close(new Error('app-server 연결 종료'));
    })().catch((err: unknown) => this.close(err instanceof Error ? err : new Error(String(err))));
  }

  onNotification(handler: (n: RpcNotification) => void): () => void {
    this.notificationHandlers.push(handler);
    return () => {
      this.notificationHandlers = this.notificationHandlers.filter((h) => h !== handler);
    };
  }

  private write(msg: Json): void {
    if (this.closed) return;
    this.output.write(JSON.stringify(msg) + '\n');
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const done = (fn: () => void) => {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        fn();
      };
      this.pending.set(id, {
        resolve: (v) => done(() => resolve(v as T)),
        reject: (e) => done(() => reject(e)),
      });
      if (timeoutMs)
        timer = setTimeout(
          () =>
            this.pending
              .get(id)
              ?.reject(new JsonRpcError(-32000, `${method} 응답 시간 초과 (${timeoutMs}ms)`)),
          timeoutMs,
        );
      this.write(params === undefined ? { method, id } : { method, id, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  /** initialize 요청 → 응답 후 initialized 알림 */
  async initialize(clientInfo: ClientInfo, timeoutMs = 15_000): Promise<Json> {
    const res = await this.request<Json>('initialize', { clientInfo, capabilities: null }, timeoutMs);
    this.notify('initialized');
    return res;
  }

  private receive(line: string): void {
    const msg = tryJson(line);
    if (!isObj(msg)) return;
    this.onMessage?.(msg);
    const hasId = typeof msg.id === 'number' || typeof msg.id === 'string';
    if (typeof msg.method === 'string') {
      if (hasId) void this.answer({ id: msg.id as RpcId, method: msg.method, params: msg.params });
      else for (const h of this.notificationHandlers) h({ method: msg.method, params: msg.params });
      return;
    }
    if (!hasId) return;
    const p = this.pending.get(msg.id as RpcId);
    if (!p) return;
    if (isObj(msg.error))
      p.reject(
        new JsonRpcError(
          Number(msg.error.code ?? -32000),
          String(msg.error.message ?? 'error'),
          msg.error.data,
        ),
      );
    else p.resolve(msg.result);
  }

  private async answer(req: RpcServerRequest): Promise<void> {
    try {
      const result = await this.onServerRequest(req);
      this.write({ id: req.id, result: result ?? null });
    } catch (err) {
      const e = err instanceof JsonRpcError ? err : new JsonRpcError(-32603, String(err));
      this.write({ id: req.id, error: { code: e.code, message: e.message } });
    }
  }

  close(reason = new Error('closed')): void {
    if (this.closed) return;
    this.closed = reason;
    for (const p of [...this.pending.values()]) p.reject(reason);
    this.pending.clear();
  }
}
