import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { PluginLoader, PluginOrigin } from './loader.js';

/**
 * 핫리로드
 * 플러그인 루트를 감시하다가 파일이 저장되면(300ms 디바운스) 해당 플러그인을 다시 올린다.
 *
 * 이벤트
 * - 'fileChange' { pluginDir, file, kind }  — 디바운스 전 원시 변경
 * - 'reloaded'   { id, version }
 * - 'failed'     { id, error }             — 이전 버전이 유지됨
 * - 'added'      { id }                    — 새 플러그인 폴더 등장
 */

export interface HotReloadOptions {
  roots: { dir: string; origin: PluginOrigin }[];
  debounceMs?: number;
  /** 테스트·특수 파일시스템(WSL /mnt 등)에서 폴링 사용 */
  usePolling?: boolean;
}

export interface FileChange {
  pluginDir: string;
  file: string;
  kind: 'add' | 'change' | 'unlink';
}

export class HotReloader extends EventEmitter {
  private watcher: FSWatcher | undefined;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly debounceMs: number;

  constructor(
    private readonly loader: PluginLoader,
    private readonly opts: HotReloadOptions,
  ) {
    super();
    this.debounceMs = opts.debounceMs ?? 300;
  }

  /** 7.1 감시 시작. 준비가 끝나면 resolve */
  async start(): Promise<void> {
    if (this.watcher) return;
    const dirs = this.opts.roots.map((r) => r.dir).filter((d) => existsSync(d));
    this.watcher = chokidar.watch(dirs, {
      ignoreInitial: true,
      ignored: (p: string) => /[\\/](node_modules|\.git)([\\/]|$)/.test(p),
      usePolling: this.opts.usePolling ?? false,
      interval: 100,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
    });
    const on = (kind: FileChange['kind']) => (file: string) => this.onFile(kind, file);
    this.watcher.on('add', on('add')).on('change', on('change')).on('unlink', on('unlink'));
    this.watcher.on('error', (err) => this.emit('error', err));
    await new Promise<void>((r) => this.watcher!.once('ready', () => r()));
  }

  async stop(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    await this.watcher?.close();
    this.watcher = undefined;
    await Promise.allSettled([...this.running.values()]);
  }

  private onFile(kind: FileChange['kind'], file: string): void {
    const hit = this.pluginDirOf(file);
    if (!hit) return;
    const change: FileChange = { pluginDir: hit.dir, file, kind };
    this.emit('fileChange', change);
    const prev = this.timers.get(hit.dir);
    if (prev) clearTimeout(prev);
    this.timers.set(
      hit.dir,
      setTimeout(() => {
        this.timers.delete(hit.dir);
        this.schedule(hit.dir, hit.origin);
      }, this.debounceMs),
    );
  }

  /** 같은 플러그인의 리로드는 직렬로 실행 */
  private schedule(dir: string, origin: PluginOrigin): void {
    const prev = this.running.get(dir) ?? Promise.resolve();
    const next = prev
      .then(() => this.reloadDir(dir, origin))
      .catch((err: unknown) => {
        this.emit('error', err);
      });
    this.running.set(dir, next);
  }

  private async reloadDir(dir: string, origin: PluginOrigin): Promise<void> {
    const p = this.loader.findByDir(dir);
    if (p) {
      const r = await this.loader.reload(p.manifest.id);
      if (r.ok) this.emit('reloaded', { id: p.manifest.id, version: r.version });
      else this.emit('failed', { id: p.manifest.id, error: r.error });
      return;
    }
    // 새로 생긴 플러그인
    if (!existsSync(dir)) return;
    const added = this.loader.register(dir, origin, { acceptChanges: true });
    if (!added) return;
    const ok = await this.loader.activate(added.manifest.id);
    this.loader.saveLock();
    if (ok) this.emit('added', { id: added.manifest.id });
    else this.emit('failed', { id: added.manifest.id, error: added.error });
  }

  /** 변경 파일이 속한 플러그인 폴더 (루트 바로 아래 폴더) */
  private pluginDirOf(file: string): { dir: string; origin: PluginOrigin } | undefined {
    for (const root of this.opts.roots) {
      const rel = relative(resolve(root.dir), resolve(file));
      if (!rel || rel.startsWith('..')) continue;
      const first = rel.split(sep)[0];
      if (!first || first === rel) return undefined; // 루트 바로 아래 파일은 플러그인이 아님
      return { dir: resolve(root.dir, first), origin: root.origin };
    }
    return undefined;
  }
}
