import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import {
  PLUGIN_SLOTS,
  PluginManifestSchema,
  providedSlots,
  type PluginManifest,
  type PluginSlot,
} from '@harness-x/protocol';
import type { EventLog } from './event-log.js';
import type { BlockingHandler, HookBus, HookName, NotifyHandler, RegisterOptions } from './hooks.js';
import { SandboxHost } from './sandbox/host.js';
import { TrustStore, type TrustLevel } from './sandbox/trust.js';

/**
 * 플러그인 로더
 * 탐색 → 매니페스트 검증 → lock 대조 → 의존성 위상정렬 → activate
 */

export const MANIFEST_FILE = 'harness-plugin.json';

export type PluginOrigin = 'user' | 'workspace' | 'core' | 'extra';

export interface PluginRoot {
  dir: string;
  origin: PluginOrigin;
}

export interface PluginContext {
  manifest: PluginManifest;
  dir: string;
  /** 플러그인 로그 (이벤트 로그 plugin_log + 콘솔 로거) */
  log(message: string): void;
  hooks: {
    onBlocking(
      name: HookName,
      handler: BlockingHandler,
      opts?: Omit<RegisterOptions, 'pluginId'>,
    ): () => void;
    onNotify(name: HookName, handler: NotifyHandler, opts?: Omit<RegisterOptions, 'pluginId'>): () => void;
  };
  config: Record<string, unknown>;
}

export interface PluginModule {
  activate?(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export type PluginState = 'discovered' | 'active' | 'inactive' | 'failed';

export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  origin: PluginOrigin;
  sha256: string;
  state: PluginState;
  error?: string;
  module?: PluginModule;
  /** 62.3 신뢰 등급 (sandbox 옵션이 있을 때만) */
  trust?: TrustLevel;
  /** 실행 위치: 메인 스레드 / 격리 워커 */
  isolation?: 'main' | 'worker';
}

/** 62 플러그인 격리 옵션. 지정하면 unsigned-isolated 등급 플러그인을 worker_threads에서 실행한다 */
export interface SandboxOptions {
  /** 승격 기록 (기본: ~/.harness-x/trust.json) */
  trust?: TrustStore;
  /** 격리 플러그인 fs 권한의 기준 루트 */
  workspace?: string;
}

export interface Rejection {
  dir: string;
  id?: string;
  reason: string;
}

export interface LockEntry {
  id: string;
  version: string;
  sha256: string;
}

export interface PluginLoaderOptions {
  hooks: HookBus;
  log?: EventLog;
  /** 탐색 루트 (기본: defaultPluginRoots) */
  roots?: PluginRoot[];
  /** plugins.lock 경로 (기본 ~/.harness-x/plugins.lock) */
  lockFile?: string;
  /** 비워질 수 없는 슬롯 (기본 ['engine']) */
  requiredSlots?: PluginSlot[];
  /** 플러그인별 설정 */
  config?: Record<string, Record<string, unknown>>;
  /** activate/deactivate 제한 시간 (기본 10초) */
  lifecycleTimeoutMs?: number;
  logger?: (line: string) => void;
  /**
   * 모듈 import 함수 (기본: 네이티브 import + ?v=<sha> 캐시 무효화).
   * 테스트 러너처럼 query를 무시하는 환경에서 교체한다.
   */
  importModule?: (file: string, sha256: string) => Promise<unknown>;
  /** 플러그인 격리 (없으면 모두 메인 스레드 — 기존 동작) */
  sandbox?: SandboxOptions;
}

export const defaultImportModule = (file: string, sha256: string): Promise<unknown> =>
  import(pathToFileURL(file).href + `?v=${sha256.slice(0, 12)}`);

export function harnessHome(): string {
  return process.env.HARNESS_X_HOME ?? join(homedir(), '.harness-x');
}

/** 6.1 기본 탐색 경로: ~/.harness-x/plugins, ~/.harness-x/plugins/forge, <workspace>/.harness-x/plugins, packages/plugins-core */
export function defaultPluginRoots(
  opts: { workspace?: string; repoRoot?: string; home?: string } = {},
): PluginRoot[] {
  const roots: PluginRoot[] = [];
  if (opts.workspace) roots.push({ dir: join(opts.workspace, '.harness-x', 'plugins'), origin: 'workspace' });
  roots.push({ dir: join(opts.home ?? harnessHome(), 'plugins'), origin: 'user' });
  // T-052 Forge가 설치한 플러그인: ~/.harness-x/plugins/forge/<id>/ (미서명·격리)
  roots.push({ dir: join(opts.home ?? harnessHome(), 'plugins', 'forge'), origin: 'user' });
  if (opts.repoRoot) roots.push({ dir: join(opts.repoRoot, 'packages', 'plugins-core'), origin: 'core' });
  return roots;
}

export class PluginLoader {
  readonly plugins = new Map<string, LoadedPlugin>();
  readonly rejections: Rejection[] = [];
  private readonly hooks: HookBus;
  private readonly log: EventLog | undefined;
  private readonly roots: PluginRoot[];
  private readonly lockFile: string;
  private readonly requiredSlots: PluginSlot[];
  private readonly config: Record<string, Record<string, unknown>>;
  private readonly lifecycleTimeoutMs: number;
  private readonly logger: (line: string) => void;
  private readonly importModule: (file: string, sha256: string) => Promise<unknown>;
  private lock: Map<string, LockEntry>;
  private readonly sandbox: (SandboxOptions & { trust: TrustStore }) | undefined;

  constructor(opts: PluginLoaderOptions) {
    this.hooks = opts.hooks;
    this.log = opts.log;
    this.roots = opts.roots ?? defaultPluginRoots();
    this.lockFile = opts.lockFile ?? join(harnessHome(), 'plugins.lock');
    this.requiredSlots = opts.requiredSlots ?? ['engine'];
    this.config = opts.config ?? {};
    this.lifecycleTimeoutMs = opts.lifecycleTimeoutMs ?? 10_000;
    this.logger = opts.logger ?? (() => {});
    this.importModule = opts.importModule ?? defaultImportModule;
    this.lock = readLock(this.lockFile);
    this.sandbox = opts.sandbox
      ? { ...opts.sandbox, trust: opts.sandbox.trust ?? new TrustStore(join(harnessHome(), 'trust.json')) }
      : undefined;
  }

  /** 6.1 탐색: 루트 바로 아래 폴더 중 harness-plugin.json이 있는 것 */
  discover(): { dir: string; origin: PluginOrigin }[] {
    const found: { dir: string; origin: PluginOrigin }[] = [];
    for (const root of this.roots) {
      if (!existsSync(root.dir)) continue;
      for (const name of readdirSync(root.dir).sort()) {
        const dir = join(root.dir, name);
        try {
          if (statSync(dir).isDirectory() && existsSync(join(dir, MANIFEST_FILE))) {
            found.push({ dir, origin: root.origin });
          }
        } catch {
          /* 접근 불가 폴더 무시 */
        }
      }
    }
    return found;
  }

  /** 탐색 + 검증 + lock 대조 + 위상정렬 + activate. 활성화된 id 순서를 돌려준다 */
  async loadAll(): Promise<string[]> {
    for (const c of this.discover()) this.register(c.dir, c.origin);
    this.checkRequires();
    const order = this.topoSort();
    for (const id of order) await this.activate(id);
    this.saveLock();
    return order.filter((id) => this.plugins.get(id)?.state === 'active');
  }

  /** 폴더 하나를 검증해 등록. 실패 시 거부 사유를 기록하고 undefined */
  register(
    dir: string,
    origin: PluginOrigin,
    opts: { acceptChanges?: boolean } = {},
  ): LoadedPlugin | undefined {
    let manifest: PluginManifest;
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8'));
      const r = PluginManifestSchema.safeParse(raw);
      if (!r.success) {
        const why = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : undefined;
        this.reject({ dir, id, reason: `매니페스트 검증 실패: ${why}` });
        return undefined;
      }
      manifest = r.data;
    } catch (err) {
      this.reject({ dir, reason: `매니페스트 읽기 실패: ${errMsg(err)}` });
      return undefined;
    }
    if (manifest.apiVersion !== 1) {
      this.reject({ dir, id: manifest.id, reason: `지원하지 않는 apiVersion ${manifest.apiVersion}` });
      return undefined;
    }
    const existing = this.plugins.get(manifest.id);
    if (existing && resolve(existing.dir) !== resolve(dir)) {
      this.reject({ dir, id: manifest.id, reason: `id 중복: ${existing.dir}에 이미 있음` });
      return undefined;
    }
    const mainPath = resolve(dir, manifest.main);
    if (!isInside(dir, mainPath)) {
      this.reject({ dir, id: manifest.id, reason: 'main이 플러그인 폴더 밖을 가리킴' });
      return undefined;
    }
    // 6.6 lock 대조
    const sha256 = hashPluginDir(dir);
    const locked = this.lock.get(manifest.id);
    // T-102 C1-005: 저장소의 기본 부품(core = <저장소>/packages/plugins-core)은 커널과 같이 설치되는 자기 코드다.
    // 그 파일을 바꿀 수 있으면 커널도 바꿀 수 있으므로 지문 검사의 보안 이득이 없고, 코드를 고쳐 다시 빌드할 때마다
    // "변조됨"으로 막혀 쓸 수 없게 된다. → core는 지문·버전이 바뀌면 거부하지 않고 lock을 새로 고친 뒤 기록만 남긴다.
    // 밖에서 들여온 플러그인(user·workspace·forge·extra)의 변조·버전 검사는 그대로다.
    if (locked && origin === 'core' && (locked.sha256 !== sha256 || locked.version !== manifest.version)) {
      const what =
        locked.version !== manifest.version
          ? `${locked.version} → ${manifest.version}`
          : `${manifest.version} 코드 변경`;
      this.logger(`기본 부품 지문 새로 고침: ${manifest.id} (${what})`);
      this.emit(
        'plugin_log',
        manifest.id,
        `기본 부품 업데이트됨: ${manifest.id} (${what}) — 지문을 새로 고쳤어요`,
      );
    } else if (locked && !opts.acceptChanges) {
      if (locked.version === manifest.version && locked.sha256 !== sha256) {
        this.reject({
          dir,
          id: manifest.id,
          reason: `plugins.lock 불일치: 파일이 변조됨 (${manifest.id}@${manifest.version})`,
        });
        return undefined;
      }
      if (locked.version !== manifest.version) {
        this.reject({
          dir,
          id: manifest.id,
          reason: `plugins.lock 버전 불일치: lock ${locked.version}, 실제 ${manifest.version} (신뢰하려면 trust 필요)`,
        });
        return undefined;
      }
    }
    this.lock.set(manifest.id, { id: manifest.id, version: manifest.version, sha256 });
    const p: LoadedPlugin = { manifest, dir, origin, sha256, state: 'discovered' };
    this.plugins.set(manifest.id, p);
    return p;
  }

  /** 사용자가 변경을 승인: lock을 현재 파일로 갱신 */
  trust(id: string): void {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`없는 플러그인: ${id}`);
    p.sha256 = hashPluginDir(p.dir);
    this.lock.set(id, { id, version: p.manifest.version, sha256: p.sha256 });
    this.saveLock();
  }

  /** 6.4 activate (의존 플러그인이 active여야 함) */
  async activate(id: string): Promise<boolean> {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`없는 플러그인: ${id}`);
    if (p.state === 'active') return true;
    for (const dep of Object.keys(p.manifest.requires)) {
      if (this.plugins.get(dep)?.state !== 'active') {
        p.state = 'failed';
        p.error = `의존 플러그인 비활성: ${dep}`;
        this.emit('plugin_failed', p.manifest.id, p.error);
        return false;
      }
    }
    if (this.sandbox) p.trust = this.sandbox.trust.levelOf({ id, sha256: p.sha256, origin: p.origin });
    try {
      if (this.sandbox && p.trust === 'unsigned-isolated') {
        // 62.1 격리 실행: 워커 안에서 import·activate, 메인과는 메시지 RPC만
        const host = this.sandboxHostFor(p);
        p.module = { deactivate: () => host.deactivate() };
        p.isolation = 'worker';
        await withTimeout(host.activate(), this.lifecycleTimeoutMs, 'activate').catch(
          async (err: unknown) => {
            await host.terminate();
            throw err;
          },
        );
      } else {
        const mod = (await this.importModule(resolve(p.dir, p.manifest.main), p.sha256)) as PluginModule & {
          default?: PluginModule;
        };
        // activate·deactivate가 없으면: default 내보내기가 있으면 그것, 없으면 모듈 전체(라이브러리형 플러그인 —
        // 예: checklist-ledger는 함수만 내보내고 커널이 그 함수로 서버 주소를 연결한다. T-102 C2-001)
        const m: PluginModule = mod.activate || mod.deactivate ? mod : (mod.default ?? mod);
        p.module = m;
        p.isolation = 'main';
        await withTimeout(
          Promise.resolve(m.activate?.(this.contextFor(p))),
          this.lifecycleTimeoutMs,
          'activate',
        );
      }
      p.state = 'active';
      delete p.error;
      this.emit('plugin_activated', id, `${id}@${p.manifest.version}`);
      return true;
    } catch (err) {
      this.hooks.removePlugin(id);
      p.state = 'failed';
      p.error = errMsg(err);
      this.emit('plugin_failed', id, p.error);
      return false;
    }
  }

  /** 6.4 / 6.5 deactivate: 필수 슬롯의 마지막 제공자나 다른 플러그인이 의존 중이면 거부 */
  async deactivate(id: string, opts: { force?: boolean } = {}): Promise<void> {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`없는 플러그인: ${id}`);
    if (p.state !== 'active') return;
    if (!opts.force) {
      for (const slot of providedSlots(p.manifest)) {
        if (!this.requiredSlots.includes(slot)) continue;
        const others = [...this.plugins.values()].filter(
          (o) => o !== p && o.state === 'active' && (o.manifest.provides[slot]?.length ?? 0) > 0,
        );
        if (others.length === 0) {
          const reason = `슬롯 최소 1개 규칙: '${slot}' 슬롯의 마지막 플러그인(${id})은 비활성화할 수 없습니다`;
          this.emit('plugin_deactivate_denied', id, reason);
          throw new Error(reason);
        }
      }
      const dependents = [...this.plugins.values()].filter(
        (o) => o.state === 'active' && id in o.manifest.requires,
      );
      if (dependents.length) {
        const reason = `의존 중인 플러그인이 있음: ${dependents.map((d) => d.manifest.id).join(', ')}`;
        this.emit('plugin_deactivate_denied', id, reason);
        throw new Error(reason);
      }
    }
    try {
      await withTimeout(Promise.resolve(p.module?.deactivate?.()), this.lifecycleTimeoutMs, 'deactivate');
    } catch (err) {
      this.emit('plugin_failed', id, `deactivate: ${errMsg(err)}`);
    } finally {
      this.hooks.removePlugin(id);
      p.state = 'inactive';
      this.emit('plugin_deactivated', id, id);
    }
  }

  /** 62.3 신뢰 등급 승격: 현재 파일 해시로 trusted 기록, 격리 실행 중이면 메인 스레드로 다시 올린다 */
  async promote(id: string): Promise<TrustLevel> {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`없는 플러그인: ${id}`);
    if (!this.sandbox)
      throw new Error('sandbox 옵션 없이 만든 로더: 모든 플러그인이 이미 메인 스레드에서 실행됨');
    this.sandbox.trust.promote(id, p.sha256);
    this.emit('plugin_promoted', id, `${id} → trusted`);
    return this.replace(p);
  }

  /** 승격 취소: 다시 unsigned-isolated, 실행 중이면 워커로 옮긴다 */
  async demote(id: string): Promise<TrustLevel> {
    const p = this.plugins.get(id);
    if (!p) throw new Error(`없는 플러그인: ${id}`);
    if (!this.sandbox) throw new Error('sandbox 옵션 없이 만든 로더');
    this.sandbox.trust.demote(id);
    this.emit('plugin_demoted', id, `${id} → unsigned-isolated`);
    return this.replace(p);
  }

  /** 등급이 바뀌어 실행 위치가 달라지면 내렸다 다시 올린다 */
  private async replace(p: LoadedPlugin): Promise<TrustLevel> {
    const id = p.manifest.id;
    const level = this.sandbox!.trust.levelOf({ id, sha256: p.sha256, origin: p.origin });
    const want = level === 'unsigned-isolated' ? 'worker' : 'main';
    p.trust = level;
    if (p.state === 'active' && p.isolation !== want) {
      await this.deactivate(id, { force: true });
      await this.activate(id);
    }
    return level;
  }

  private sandboxHostFor(p: LoadedPlugin): SandboxHost {
    const id = p.manifest.id;
    return new SandboxHost({
      manifest: p.manifest,
      dir: p.dir,
      sha256: p.sha256,
      hooks: this.hooks,
      config: this.config[id] ?? {},
      workspace: this.sandbox?.workspace,
      log: (message) => {
        this.logger(`[${id}] ${message}`);
        this.emit('plugin_log', id, message);
      },
      onDenied: (d) => this.emit('permission_denied', id, d.reason, { kind: d.kind, method: d.method }),
    });
  }

  /** 격리 플러그인 핫리로드: 새 워커를 먼저 올리고 성공하면 이전 것을 내린다 (메인 스레드에서 import하지 않는다) */
  private async reloadIsolated(
    old: LoadedPlugin,
    manifest: PluginManifest,
    sha256: string,
    fail: (error: string) => { ok: boolean; error?: string; version?: string },
  ): Promise<{ ok: boolean; error?: string; version?: string }> {
    const id = manifest.id;
    const next: LoadedPlugin = {
      manifest,
      dir: old.dir,
      origin: old.origin,
      sha256,
      state: 'discovered',
      trust: 'unsigned-isolated',
      isolation: 'worker',
    };
    const wasActive = old.state === 'active';
    // 메인 스레드 플러그인의 훅은 pluginId로 지워야 하므로 먼저 내린다
    if (wasActive && old.isolation !== 'worker') await this.deactivate(id, { force: true });
    const host = this.sandboxHostFor(next);
    try {
      await withTimeout(host.activate(), this.lifecycleTimeoutMs, 'activate');
    } catch (err) {
      await host.terminate();
      return fail(`activate 실패: ${errMsg(err)}`);
    }
    next.module = { deactivate: () => host.deactivate() };
    if (wasActive && old.isolation === 'worker') {
      try {
        await withTimeout(Promise.resolve(old.module?.deactivate?.()), this.lifecycleTimeoutMs, 'deactivate');
      } catch (err) {
        this.emit('plugin_failed', id, `deactivate: ${errMsg(err)}`);
      }
    }
    next.state = 'active';
    this.plugins.set(id, next);
    this.lock.set(id, { id, version: manifest.version, sha256 });
    this.saveLock();
    this.emit('plugin_reloaded', id, `${id}@${manifest.version}`);
    return { ok: true, version: manifest.version };
  }

  /** 6.6 lock 저장 (원자적 교체) */
  saveLock(): void {
    writeLock(this.lockFile, this.lock);
  }

  /** 슬롯별 활성 플러그인 */
  activeBySlot(): Record<PluginSlot, string[]> {
    const out = Object.fromEntries(PLUGIN_SLOTS.map((s) => [s, [] as string[]])) as Record<
      PluginSlot,
      string[]
    >;
    for (const p of this.plugins.values()) {
      if (p.state !== 'active') continue;
      for (const s of providedSlots(p.manifest)) out[s].push(p.manifest.id);
    }
    return out;
  }

  /** 핫리로드용: 플러그인을 목록에서 빼고 다시 등록할 수 있게 한다 */
  forget(id: string): LoadedPlugin | undefined {
    const p = this.plugins.get(id);
    this.plugins.delete(id);
    return p;
  }

  /** 폴더 경로로 등록된 플러그인 찾기 */
  findByDir(dir: string): LoadedPlugin | undefined {
    const want = resolve(dir);
    return [...this.plugins.values()].find((p) => resolve(p.dir) === want);
  }

  /**
   * 7.2 / 7.3 핫리로드: 새 매니페스트·모듈을 먼저 검증·로드하고, 이전 버전을 내린 뒤 새 버전을 올린다.
   * 어느 단계든 실패하면 이전 버전을 그대로(또는 다시) 활성 상태로 둔다.
   * 개발 중 변경이므로 plugins.lock은 새 내용으로 갱신한다.
   */
  async reload(id: string): Promise<{ ok: boolean; error?: string; version?: string }> {
    const old = this.plugins.get(id);
    if (!old) return { ok: false, error: `없는 플러그인: ${id}` };
    const fail = (error: string) => {
      this.emit('plugin_reload_failed', id, error);
      return { ok: false, error, version: old.manifest.version };
    };

    // 1) 재검증
    let manifest: PluginManifest;
    try {
      const r = PluginManifestSchema.safeParse(
        JSON.parse(readFileSync(join(old.dir, MANIFEST_FILE), 'utf8')),
      );
      if (!r.success) return fail(`매니페스트 검증 실패: ${r.error.issues.map((i) => i.message).join('; ')}`);
      manifest = r.data;
    } catch (err) {
      return fail(`매니페스트 읽기 실패: ${errMsg(err)}`);
    }
    if (manifest.id !== id) return fail(`id 변경은 핫리로드로 할 수 없음: ${id} → ${manifest.id}`);
    for (const dep of Object.keys(manifest.requires)) {
      if (this.plugins.get(dep)?.state !== 'active') return fail(`의존 플러그인 비활성: ${dep}`);
    }
    const sha256 = hashPluginDir(old.dir);
    if (
      this.sandbox &&
      this.sandbox.trust.levelOf({ id, sha256, origin: old.origin }) === 'unsigned-isolated'
    ) {
      return this.reloadIsolated(old, manifest, sha256, fail);
    }

    // 2) 새 모듈 로드 (문법 오류 등은 여기서 걸림)
    let mod: PluginModule;
    try {
      const m = (await this.importModule(resolve(old.dir, manifest.main), sha256)) as PluginModule & {
        default?: PluginModule;
      };
      mod = m.activate || m.deactivate ? m : (m.default ?? m); // 핫리로드도 같은 규칙(T-102 C2-001)
    } catch (err) {
      return fail(`모듈 로드 실패: ${errMsg(err)}`);
    }

    // 3) 이전 버전 내리기
    const wasActive = old.state === 'active';
    if (wasActive) {
      try {
        await withTimeout(Promise.resolve(old.module?.deactivate?.()), this.lifecycleTimeoutMs, 'deactivate');
      } catch (err) {
        this.emit('plugin_failed', id, `deactivate: ${errMsg(err)}`);
      }
      this.hooks.removePlugin(id);
    }

    // 4) 새 버전 올리기
    const next: LoadedPlugin = {
      manifest,
      dir: old.dir,
      origin: old.origin,
      sha256,
      state: 'discovered',
      module: mod,
    };
    try {
      await withTimeout(
        Promise.resolve(mod.activate?.(this.contextFor(next))),
        this.lifecycleTimeoutMs,
        'activate',
      );
    } catch (err) {
      this.hooks.removePlugin(id);
      // 이전 버전 복구
      if (wasActive) {
        try {
          await withTimeout(
            Promise.resolve(old.module?.activate?.(this.contextFor(old))),
            this.lifecycleTimeoutMs,
            'activate',
          );
        } catch (e2) {
          old.state = 'failed';
          old.error = `복구 실패: ${errMsg(e2)}`;
        }
      }
      return fail(`activate 실패: ${errMsg(err)}`);
    }
    next.state = 'active';
    this.plugins.set(id, next);
    this.lock.set(id, { id, version: manifest.version, sha256 });
    this.saveLock();
    this.emit('plugin_reloaded', id, `${id}@${manifest.version}`);
    return { ok: true, version: manifest.version };
  }

  /** 6.3 의존성: 존재·버전 범위 검사 (없으면 연쇄 거부) */
  private checkRequires(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of [...this.plugins.values()]) {
        if (p.state !== 'discovered') continue;
        for (const [dep, range] of Object.entries(p.manifest.requires)) {
          const d = this.plugins.get(dep);
          let reason: string | undefined;
          if (!d) reason = `의존 플러그인 없음: ${dep}`;
          else if (!semver.validRange(range)) reason = `잘못된 버전 범위: ${dep}@${range}`;
          else if (!semver.satisfies(d.manifest.version, range, { includePrerelease: true }))
            reason = `의존 버전 불일치: ${dep}@${d.manifest.version} ∉ ${range}`;
          if (reason) {
            this.plugins.delete(p.manifest.id);
            this.reject({ dir: p.dir, id: p.manifest.id, reason });
            changed = true;
            break;
          }
        }
      }
    }
  }

  /** 6.3 위상정렬 (Kahn). 순환에 걸린 플러그인은 거부 */
  private topoSort(): string[] {
    const ids = [...this.plugins.values()].filter((p) => p.state === 'discovered').map((p) => p.manifest.id);
    const indeg = new Map(ids.map((id) => [id, 0]));
    const out = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const id of ids) {
      for (const dep of Object.keys(this.plugins.get(id)!.manifest.requires)) {
        if (!indeg.has(dep)) continue;
        indeg.set(id, (indeg.get(id) ?? 0) + 1);
        out.get(dep)!.push(id);
      }
    }
    const queue = ids.filter((id) => indeg.get(id) === 0).sort();
    const order: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      for (const next of out.get(id)!.sort()) {
        indeg.set(next, indeg.get(next)! - 1);
        if (indeg.get(next) === 0) queue.push(next);
      }
    }
    const cyclic = ids.filter((id) => !order.includes(id));
    for (const id of cyclic) {
      const p = this.plugins.get(id)!;
      this.plugins.delete(id);
      this.reject({ dir: p.dir, id, reason: `의존성 순환: ${cyclic.join(' → ')}` });
    }
    return order;
  }

  private contextFor(p: LoadedPlugin): PluginContext {
    const pluginId = p.manifest.id;
    return {
      manifest: p.manifest,
      dir: p.dir,
      config: this.config[pluginId] ?? {},
      log: (message: string) => {
        this.logger(`[${pluginId}] ${message}`);
        this.emit('plugin_log', pluginId, message);
      },
      hooks: {
        onBlocking: (name, handler, opts = {}) => this.hooks.onBlocking(name, handler, { ...opts, pluginId }),
        onNotify: (name, handler, opts = {}) => this.hooks.onNotify(name, handler, { ...opts, pluginId }),
      },
    };
  }

  /** 6.2 거부 사유 기록 */
  private reject(r: Rejection): void {
    this.rejections.push(r);
    this.logger(`plugin rejected ${r.id ?? r.dir}: ${r.reason}`);
    this.emit('plugin_rejected', r.id, r.reason, { dir: r.dir });
  }

  private emit(
    type: string,
    pluginId: string | undefined,
    message: string,
    extra: Record<string, unknown> = {},
  ): void {
    if (!this.log) return;
    try {
      this.log.append({
        id: randomUUID(),
        ts: new Date().toISOString(),
        sessionId: 'kernel',
        type,
        ...(pluginId ? { pluginId } : {}),
        message,
        ...extra,
      });
    } catch {
      /* 로그 실패는 로딩을 막지 않는다 */
    }
  }
}

/** 플러그인 폴더 내용의 sha256 (상대 경로 + 내용, node_modules·.git 제외) */
export function hashPluginDir(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) {
        h.update(relative(dir, full).split(sep).join('/'));
        h.update('\0');
        h.update(readFileSync(full));
        h.update('\0');
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

function writeLock(file: string, lock: Map<string, LockEntry>): void {
  const entries = [...lock.values()].sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ lockfileVersion: 1, plugins: entries }, null, 2) + '\n');
  renameSync(tmp, file);
}

/** plugins.lock 항목 목록 (파일이 없거나 깨졌으면 빈 배열) */
export function listLockEntries(file: string): LockEntry[] {
  return [...readLock(file).values()];
}

/**
 * plugins.lock에서 항목 제거 — 저장소에서 삭제된 플러그인의 흔적 정리 (T-100 J.2).
 * 지운 id 목록을 돌려준다. 없는 id는 무시하고, 바뀐 것이 없으면 파일을 다시 쓰지 않는다.
 */
export function removeLockEntries(file: string, ids: readonly string[]): string[] {
  if (!existsSync(file)) return [];
  const lock = readLock(file);
  const removed = [...new Set(ids)].filter((id) => lock.delete(id));
  if (removed.length) writeLock(file, lock);
  return removed;
}

function readLock(file: string): Map<string, LockEntry> {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { plugins?: LockEntry[] };
    return new Map((data.plugins ?? []).map((e) => [e.id, e]));
  } catch {
    return new Map();
  }
}

function isInside(dir: string, target: string): boolean {
  const rel = relative(resolve(dir), resolve(target));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${what} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        res(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        rej(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
