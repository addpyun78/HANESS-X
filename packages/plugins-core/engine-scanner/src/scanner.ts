import {
  defaultEnginesCacheFile,
  ENGINES_CACHE_VERSION,
  readEnginesCache,
  writeEnginesCache,
  type EngineEntry,
  type EnginesCache,
  type LocalLlmEntry,
} from './cache.js';
import { probeLocalLlms } from './probes/all.js';
import {
  finishProgress,
  isRescanReason,
  progressFromCache,
  startProgress,
  withEngines,
  withLocalLlms,
  withTimeout,
  type RescanReason,
  type ScanProgress,
} from './progress.js';
import { scanAllEngines } from './wsl.js';

/** 12.5 시작 시 1회 + 30분 주기 + POST /api/engines/rescan */
export const RESCAN_INTERVAL_MS = 30 * 60 * 1000;
export const RESCAN_ROUTE = '/api/engines/rescan';

export interface EngineScannerOptions {
  cacheFile?: string;
  intervalMs?: number;
  platform?: NodeJS.Platform;
  /** CLI 탐지 (기본: PATH + WSL) */
  scanEngines?: () => Promise<EngineEntry[]>;
  /** 로컬 LLM 프로브 (기본: 5종 병렬) */
  probeLocalLlms?: () => Promise<LocalLlmEntry[]>;
  now?: () => Date;
  onScan?: (cache: EnginesCache) => void;
  onError?: (err: unknown) => void;
  /** 시작 스캔에서 CLI를 하나도 못 찾으면 이만큼 뒤에 1번 더 스캔 (WSL /mnt/c PATH 첫 조회가 느려 시간 초과되는 경우). 0이면 끔 */
  startupRetryMs?: number;
  /**
   * T-101 5A.6 로그인 상태 (공식 상태 명령만, 모델 호출 없음). 엔진마다 statusTimeoutMs 안에 끝나지 않으면 unknown.
   * 없으면 로그인 상태를 확인하지 않는다
   */
  loginStatus?: (e: EngineEntry) => Promise<NonNullable<EngineEntry['login']>>;
  /** 5A.5 엔진별 상태 확인 제한 (기본 5초). PATH 조회 제한(which 20초)과는 별개 */
  statusTimeoutMs?: number;
  /** 진행 상태가 바뀔 때마다 */
  onProgress?: (p: ScanProgress) => void;
}

/** 5A.5 엔진별 상태 확인 제한 시간 */
export const STATUS_TIMEOUT_MS = 5_000;

export const STARTUP_RETRY_MS = 15_000;

export class EngineScanner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<EnginesCache> | undefined;
  private current: ScanProgress | undefined;
  last: EnginesCache | undefined;
  readonly cacheFile: string;

  constructor(private readonly opts: EngineScannerOptions = {}) {
    this.cacheFile = opts.cacheFile ?? defaultEnginesCacheFile();
  }

  /** 지금 진행 상태 (스캔 전이면 캐시 기준) */
  get progress(): ScanProgress {
    return this.current ?? progressFromCache(this.last);
  }

  private setProgress(p: ScanProgress): void {
    this.current = p;
    this.opts.onProgress?.(p);
  }

  /** 스캔 후 캐시 기록. 진행 중인 스캔이 있으면 그 결과를 함께 기다린다 */
  scan(reason: RescanReason = 'manual'): Promise<EnginesCache> {
    this.inflight ??= this.runScan(isRescanReason(reason) ? reason : 'manual').finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  /** 5A.5 엔진마다 로그인 상태 확인 (병렬, 엔진별 제한 시간) */
  private async withLogin(engines: EngineEntry[]): Promise<EngineEntry[]> {
    const check = this.opts.loginStatus;
    if (!check) return engines;
    const ms = this.opts.statusTimeoutMs ?? STATUS_TIMEOUT_MS;
    return Promise.all(
      engines.map(async (e) => ({ ...e, login: await withTimeout(check(e), ms, 'unknown' as const) })),
    );
  }

  private async runScan(reason: RescanReason): Promise<EnginesCache> {
    const platform = this.opts.platform ?? process.platform;
    const prev = this.last ?? readEnginesCache(this.cacheFile);
    this.setProgress(startProgress(reason, this.now()));
    // PATH·WSL·ACP(같은 PATH 조회) CLI 탐지와 로컬 LLM 포트 확인을 병렬로
    const [engines, localLlms] = await Promise.all([
      (this.opts.scanEngines ? this.opts.scanEngines() : scanAllEngines({ platform }))
        .then((list) => this.withLogin(list))
        .then((list) => {
          if (this.current) this.setProgress(withEngines(this.current, list));
          return list;
        }),
      (this.opts.probeLocalLlms ? this.opts.probeLocalLlms() : probeLocalLlms()).then((list) => {
        if (this.current) this.setProgress(withLocalLlms(this.current, list));
        return list;
      }),
    ]).catch((err: unknown) => {
      this.current = undefined;
      throw err;
    });
    const cache = writeEnginesCache(
      {
        version: ENGINES_CACHE_VERSION,
        scannedAt: this.now().toISOString(),
        platform,
        engines,
        localLlms,
      },
      this.cacheFile,
    );
    this.last = cache;
    this.setProgress(
      finishProgress(this.current ?? startProgress(reason, this.now()), prev, cache, this.now()),
    );
    this.opts.onScan?.(cache);
    return cache;
  }

  /**
   * 시작 시 1회 스캔 + 주기 재스캔 예약.
   * 5A.2 캐시(engines.json)가 있으면 스캔 전에 바로 `last`·`progress`로 보여 줄 수 있게 먼저 읽는다
   */
  start(): Promise<EnginesCache> {
    this.stop();
    this.last ??= readEnginesCache(this.cacheFile) ?? undefined;
    const interval = this.opts.intervalMs ?? RESCAN_INTERVAL_MS;
    this.timer = setInterval(() => {
      this.scan('interval').catch((err) => this.opts.onError?.(err));
    }, interval);
    this.timer.unref?.();
    const retryMs = this.opts.startupRetryMs ?? STARTUP_RETRY_MS;
    return this.scan('startup').then((first) => {
      if (first.engines.length === 0 && retryMs > 0 && this.timer) {
        this.retry = setTimeout(() => {
          this.retry = undefined;
          this.scan('startup').catch((err) => this.opts.onError?.(err));
        }, retryMs);
        this.retry.unref?.();
      }
      return first;
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.timer = undefined;
    this.retry = undefined;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }
}

export const SCAN_STATUS_ROUTE = '/api/engines/scan-status';

/** Fastify 등 라우트를 등록할 수 있는 서버 (구조적 타입) */
export interface RouteHost {
  post(path: string, handler: (req: { body?: unknown }) => Promise<unknown>): unknown;
  get?(path: string, handler: () => Promise<unknown>): unknown;
}

/** 라우트가 쓰는 스캐너 모양 (커널은 핫리로드 뒤 현재 스캐너로 위임하는 얇은 객체를 넘긴다) */
export interface ScannerLike {
  scan(reason?: RescanReason): Promise<unknown>;
  readonly progress?: ScanProgress;
}

/**
 * POST /api/engines/rescan {reason?} → 재스캔 후 새 캐시 반환 (5A.9 reason: install | manual …)
 * GET /api/engines/scan-status → 말풍선용 진행 상태 (스캔을 기다리지 않고 바로 응답)
 */
export function registerRescanRoute(app: RouteHost, scanner: ScannerLike): void {
  app.post(RESCAN_ROUTE, async (req) => {
    const r = (req?.body as { reason?: unknown } | undefined)?.reason;
    return { ok: true, cache: await scanner.scan(isRescanReason(r) ? r : 'manual') };
  });
  app.get?.(SCAN_STATUS_ROUTE, async () => scanner.progress ?? progressFromCache(null));
}
