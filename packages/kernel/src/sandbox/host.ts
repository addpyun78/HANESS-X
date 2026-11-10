import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { PluginManifest } from '@harness-x/protocol';
import type { HookBus, HookName, HookResult, RegisterOptions } from '../hooks.js';
import { PermissionDeniedError, checkFs, checkNet, checkShell, type PermissionCheck } from './permissions.js';
import { SANDBOX_ALLOWED_BUILTINS, SANDBOX_HOOKS_SOURCE, SANDBOX_WORKER_SOURCE } from './worker-source.js';

/**
 * 격리 플러그인 호스트 (메인 스레드 쪽)
 * 워커 하나에 플러그인 하나. 워커와는 메시지 RPC만 오간다.
 * 워커가 요청한 fs/net/shell 호출은 여기서 매니페스트 권한으로 검사(62.2)한 뒤 대신 수행한다.
 */

export interface SandboxDenial {
  pluginId: string;
  kind: 'fs' | 'net' | 'shell';
  method: string;
  reason: string;
}

export interface SandboxHostOptions {
  manifest: PluginManifest;
  dir: string;
  sha256: string;
  hooks: HookBus;
  config?: Record<string, unknown>;
  /** fs 권한의 기준 루트 (workspace:read/write) */
  workspace?: string;
  log?: (message: string) => void;
  onDenied?: (d: SandboxDenial) => void;
  /** shell 실행 제한 시간 (기본 30초) */
  shellTimeoutMs?: number;
  /** 워커 힙 상한 MB (기본 256) */
  maxHeapMb?: number;
}

type FromWorker =
  | { t: 'ready' }
  | { t: 'log'; message: string }
  | { t: 'activated' }
  | { t: 'activate-failed'; error: { message: string; code?: string } }
  | { t: 'deactivated'; error?: { message: string } }
  | { t: 'rpc'; id: number; method: string; args: unknown[] }
  | {
      t: 'hook-register';
      regId: number;
      mode: 'blocking' | 'notify';
      name: HookName;
      opts: Omit<RegisterOptions, 'pluginId'>;
    }
  | { t: 'hook-unregister'; regId: number }
  | { t: 'hook-result'; callId: number; ok: boolean; value?: unknown; error?: { message: string } };

export class SandboxHost {
  private worker: Worker | undefined;
  private readonly unregister = new Map<number, () => void>();
  private readonly hookCalls = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private callSeq = 0;
  private waiters: { t: string[]; resolve: (m: FromWorker) => void; reject: (e: Error) => void }[] = [];
  private exited = false;

  constructor(private readonly opts: SandboxHostOptions) {}

  get pluginId(): string {
    return this.opts.manifest.id;
  }

  get running(): boolean {
    return !!this.worker && !this.exited;
  }

  /** 워커를 띄우고 플러그인 activate. 실패 시 워커를 내리고 예외 */
  async activate(): Promise<void> {
    const mainFile = resolve(this.opts.dir, this.opts.manifest.main);
    const worker = new Worker(SANDBOX_WORKER_SOURCE, {
      eval: true,
      env: {},
      workerData: {
        hooksSource: SANDBOX_HOOKS_SOURCE,
        allowedBuiltins: [...SANDBOX_ALLOWED_BUILTINS],
        mainUrl: pathToFileURL(mainFile).href + `?v=${this.opts.sha256.slice(0, 12)}`,
        manifest: JSON.parse(JSON.stringify(this.opts.manifest)) as unknown,
        dir: this.opts.dir,
        config: JSON.parse(JSON.stringify(this.opts.config ?? {})) as unknown,
      },
      resourceLimits: { maxOldGenerationSizeMb: this.opts.maxHeapMb ?? 256 },
      stdout: false,
      stderr: false,
    });
    this.worker = worker;
    this.exited = false;
    worker.on('message', (m: FromWorker) => void this.onMessage(m));
    worker.on('error', (err) => this.fail(err));
    worker.on('exit', (code) => this.fail(new Error(`sandbox worker exited (${code})`)));

    try {
      await this.waitFor(['ready']);
      worker.postMessage({ t: 'activate' });
      const r = await this.waitFor(['activated', 'activate-failed']);
      if (r.t === 'activate-failed') throw Object.assign(new Error(r.error.message), { code: r.error.code });
    } catch (err) {
      await this.terminate();
      throw err;
    }
  }

  /** 플러그인 deactivate 후 워커 종료 */
  async deactivate(): Promise<void> {
    if (this.running) {
      this.worker!.postMessage({ t: 'deactivate' });
      try {
        await this.waitFor(['deactivated']);
      } catch {
        /* 워커가 이미 죽었으면 그냥 정리 */
      }
    }
    await this.terminate();
  }

  async terminate(): Promise<void> {
    for (const off of this.unregister.values()) off();
    this.unregister.clear();
    const w = this.worker;
    this.worker = undefined;
    if (w && !this.exited) {
      this.exited = true;
      await w.terminate();
    }
    this.fail(new Error('sandbox terminated'));
  }

  private waitFor(t: string[]): Promise<FromWorker> {
    if (this.exited) return Promise.reject(new Error('sandbox worker not running'));
    return new Promise((resolve, reject) => this.waiters.push({ t, resolve, reject }));
  }

  private fail(err: Error): void {
    this.exited = true;
    for (const w of this.waiters.splice(0)) w.reject(err);
    for (const c of this.hookCalls.values()) c.reject(err);
    this.hookCalls.clear();
  }

  private post(msg: unknown): void {
    if (this.running) this.worker!.postMessage(msg);
  }

  private async onMessage(m: FromWorker): Promise<void> {
    const w = this.waiters.findIndex((x) => x.t.includes(m.t));
    if (w >= 0) {
      this.waiters.splice(w, 1)[0]!.resolve(m);
      return;
    }
    switch (m.t) {
      case 'log':
        this.opts.log?.(m.message);
        return;
      case 'rpc':
        try {
          const value = await this.rpc(m.method, m.args);
          this.post({ t: 'rpc-result', id: m.id, ok: true, value });
        } catch (err) {
          const e = err as Error & { code?: string };
          this.post({ t: 'rpc-result', id: m.id, ok: false, error: { message: e.message, code: e.code } });
        }
        return;
      case 'hook-register':
        this.registerHook(m.regId, m.mode, m.name, m.opts);
        return;
      case 'hook-unregister':
        this.unregister.get(m.regId)?.();
        this.unregister.delete(m.regId);
        return;
      case 'hook-result': {
        const c = this.hookCalls.get(m.callId);
        if (!c) return;
        this.hookCalls.delete(m.callId);
        if (m.ok) c.resolve(m.value);
        else c.reject(new Error(m.error?.message ?? 'hook failed'));
        return;
      }
      default:
        return;
    }
  }

  private registerHook(
    regId: number,
    mode: 'blocking' | 'notify',
    name: HookName,
    opts: Omit<RegisterOptions, 'pluginId'>,
  ): void {
    const pluginId = this.pluginId;
    const relay = (ctx: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        if (!this.running) return reject(new Error('sandbox worker not running'));
        const callId = ++this.callSeq;
        this.hookCalls.set(callId, { resolve, reject });
        this.post({ t: 'hook', callId, regId, ctx: JSON.parse(JSON.stringify(ctx ?? {})) as unknown });
      });
    const off =
      mode === 'blocking'
        ? this.opts.hooks.onBlocking(name, async (c) => (await relay(c)) as HookResult | void, {
            ...opts,
            pluginId,
          })
        : this.opts.hooks.onNotify(
            name,
            async (c) => {
              await relay(c);
            },
            { ...opts, pluginId },
          );
    this.unregister.set(regId, off);
  }

  // ── 62.2 권한 프록시 ──────────────────────────────────────
  private guard(kind: SandboxDenial['kind'], method: string, check: PermissionCheck): void {
    if (check.ok) return;
    const reason = check.reason ?? 'denied';
    this.opts.onDenied?.({ pluginId: this.pluginId, kind, method, reason });
    throw new PermissionDeniedError(kind, `${this.pluginId}: ${method} 거부 — ${reason}`);
  }

  private async rpc(method: string, args: unknown[]): Promise<unknown> {
    const perms = this.opts.manifest.permissions;
    const ws = this.opts.workspace;
    const path = String(args[0] ?? '');
    switch (method) {
      case 'fs.readFile':
        this.guard('fs', method, checkFs(perms, ws, 'read', path));
        return readFile(resolve(ws!, path), 'utf8');
      case 'fs.readdir':
        this.guard('fs', method, checkFs(perms, ws, 'read', path));
        return readdir(resolve(ws!, path));
      case 'fs.writeFile': {
        this.guard('fs', method, checkFs(perms, ws, 'write', path));
        const file = resolve(ws!, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, String(args[1] ?? ''));
        return undefined;
      }
      case 'net.fetch': {
        this.guard('net', method, checkNet(perms, path));
        const init = (args[1] ?? {}) as { method?: string; headers?: Record<string, string>; body?: string };
        const res = await fetch(path, { ...init, redirect: 'manual' });
        return {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          body: await res.text(),
        };
      }
      case 'shell.exec': {
        this.guard('shell', method, checkShell(perms));
        const cmd = path;
        const cmdArgs = (args[1] as string[] | undefined) ?? [];
        return new Promise((res) => {
          execFile(
            cmd,
            cmdArgs,
            { cwd: ws, timeout: this.opts.shellTimeoutMs ?? 30_000, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout, stderr) => {
              const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
              res({ code, stdout: String(stdout), stderr: String(stderr) });
            },
          );
        });
      }
      default:
        throw new Error(`모르는 sandbox 호출: ${method}`);
    }
  }
}
