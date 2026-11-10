import {
  defaultEnginesCacheFile,
  ENGINES_CACHE_VERSION,
  writeEnginesCache,
  type EngineEntry,
  type EnginesCache,
  type LocalLlmEntry,
} from './cache.js';
import { probeLocalLlms } from './probes/all.js';
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
}

export class EngineScanner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inflight: Promise<EnginesCache> | undefined;
  last: EnginesCache | undefined;
  readonly cacheFile: string;

  constructor(private readonly opts: EngineScannerOptions = {}) {
    this.cacheFile = opts.cacheFile ?? defaultEnginesCacheFile();
  }

  /** 스캔 후 캐시 기록. 진행 중인 스캔이 있으면 그 결과를 함께 기다린다 */
  scan(): Promise<EnginesCache> {
    this.inflight ??= this.runScan().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async runScan(): Promise<EnginesCache> {
    const platform = this.opts.platform ?? process.platform;
    const [engines, localLlms] = await Promise.all([
      this.opts.scanEngines ? this.opts.scanEngines() : scanAllEngines({ platform }),
      this.opts.probeLocalLlms ? this.opts.probeLocalLlms() : probeLocalLlms(),
    ]);
    const cache = writeEnginesCache(
      {
        version: ENGINES_CACHE_VERSION,
        scannedAt: (this.opts.now?.() ?? new Date()).toISOString(),
        platform,
        engines,
        localLlms,
      },
      this.cacheFile,
    );
    this.last = cache;
    this.opts.onScan?.(cache);
    return cache;
  }

  /** 시작 시 1회 스캔 + 주기 재스캔 예약 */
  start(): Promise<EnginesCache> {
    this.stop();
    const interval = this.opts.intervalMs ?? RESCAN_INTERVAL_MS;
    this.timer = setInterval(() => {
      this.scan().catch((err) => this.opts.onError?.(err));
    }, interval);
    this.timer.unref?.();
    return this.scan();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }
}

/** Fastify 등 라우트를 등록할 수 있는 서버 (구조적 타입) */
export interface RouteHost {
  post(path: string, handler: () => Promise<unknown>): unknown;
}

/** POST /api/engines/rescan → 재스캔 후 새 캐시 반환 */
export function registerRescanRoute(app: RouteHost, scanner: EngineScanner): void {
  app.post(RESCAN_ROUTE, async () => ({ ok: true, cache: await scanner.scan() }));
}
