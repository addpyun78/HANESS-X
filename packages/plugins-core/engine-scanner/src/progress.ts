import type { EngineEntry, EnginesCache, LocalLlmEntry } from './cache.js';

/**
 * T-101 5A 시작 화면 가운데 말풍선용 스캔 진행 상태.
 * 모델 호출 없이(설치·버전·로그인 상태 명령만) 엔진마다 … → ✓ / 로그인 필요 / 없음 으로 바뀐다.
 */

/** 재스캔 시점 (5A.9): 시작 · 30분마다 · 설치 관리에서 설치 완료 · 설정 [다시 찾기] */
export const RESCAN_REASONS = ['startup', 'interval', 'install', 'manual'] as const;
export type RescanReason = (typeof RESCAN_REASONS)[number];
export const isRescanReason = (v: unknown): v is RescanReason =>
  typeof v === 'string' && (RESCAN_REASONS as readonly string[]).includes(v);

export type EngineProgressState = 'checking' | 'ready' | 'needs-login' | 'missing';

export interface EngineProgressItem {
  /** 스캐너 이름 (claude, codex, agy, ollama …) */
  name: string;
  /** 화면 이름 (Claude Code, Codex …) */
  label: string;
  state: EngineProgressState;
  /** 로컬 LLM 서버면 모델 개수 */
  models?: number;
}

export interface ScanProgress {
  state: 'idle' | 'scanning' | 'done';
  reason?: RescanReason;
  startedAt?: string;
  finishedAt?: string;
  engines: EngineProgressItem[];
  /** 찾은 엔진 수 (CLI + 로컬 LLM 서버) */
  found: number;
  /** 이전 캐시와 비교해 새로 생긴 / 사라진 엔진 (5A.4) */
  added: string[];
  removed: string[];
}

/** 말풍선에 늘 보여 줄 대표 엔진 (없으면 "없음"으로 표시) */
export const PROGRESS_TARGETS = ['claude', 'codex', 'agy', 'gemini'] as const;

const LABELS: Readonly<Record<string, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  agy: 'Antigravity',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  'cursor-agent': 'Cursor',
  qwen: 'Qwen Code',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  llamacpp: 'llama.cpp',
  vllm: 'vLLM',
  jan: 'Jan',
};
export const engineLabel = (name: string): string => LABELS[name] ?? name;

/** 캐시 → 엔진 이름 집합 (CLI는 이름, 로컬 LLM은 서버 이름) */
export function engineNames(cache: Pick<EnginesCache, 'engines' | 'localLlms'> | null | undefined): string[] {
  if (!cache) return [];
  return [...new Set([...cache.engines.map((e) => e.name), ...cache.localLlms.map((l) => l.name)])];
}

/** 5A.4 새로 생기거나 사라진 엔진. 이전 캐시가 없으면(처음 실행) 변화 없음으로 본다 */
export function diffEngines(
  prev: Pick<EnginesCache, 'engines' | 'localLlms'> | null | undefined,
  next: Pick<EnginesCache, 'engines' | 'localLlms'>,
): { added: string[]; removed: string[] } {
  if (!prev) return { added: [], removed: [] };
  const a = new Set(engineNames(prev));
  const b = new Set(engineNames(next));
  return { added: [...b].filter((n) => !a.has(n)), removed: [...a].filter((n) => !b.has(n)) };
}

/** 한 엔진 항목의 진행 상태 (로그아웃이 확실할 때만 로그인 필요) */
export function entryState(e: Pick<EngineEntry, 'login'>): EngineProgressState {
  return e.login === 'loggedOut' ? 'needs-login' : 'ready';
}

/** 스캔 시작: 대표 엔진을 모두 "확인 중"으로 */
export function startProgress(reason: RescanReason, now: Date): ScanProgress {
  return {
    state: 'scanning',
    reason,
    startedAt: now.toISOString(),
    engines: PROGRESS_TARGETS.map((name) => ({ name, label: engineLabel(name), state: 'checking' as const })),
    found: 0,
    added: [],
    removed: [],
  };
}

/** CLI 결과 반영 (같은 이름이 여러 위치면 하나라도 준비됨이면 준비됨) */
export function withEngines(p: ScanProgress, engines: readonly EngineEntry[]): ScanProgress {
  const byName = new Map<string, EngineProgressState>();
  for (const e of engines) {
    const s = entryState(e);
    if (byName.get(e.name) !== 'ready') byName.set(e.name, s);
  }
  const list = p.engines
    .filter((x) => x.models === undefined)
    .map((x) => ({ ...x, state: byName.get(x.name) ?? ('missing' as const) }));
  for (const [name, state] of byName)
    if (!list.some((x) => x.name === name)) list.push({ name, label: engineLabel(name), state });
  return { ...p, engines: [...list, ...p.engines.filter((x) => x.models !== undefined)] };
}

/** 로컬 LLM 서버 결과 반영 (응답한 서버만 ✓) */
export function withLocalLlms(p: ScanProgress, llms: readonly LocalLlmEntry[]): ScanProgress {
  const rest = p.engines.filter((x) => x.models === undefined);
  return {
    ...p,
    engines: [
      ...rest,
      ...llms.map((l) => ({
        name: l.name,
        label: engineLabel(l.name),
        state: 'ready' as const,
        models: l.models.length,
      })),
    ],
  };
}

/** 스캔 끝: 찾은 수 + 이전 캐시와의 차이 */
export function finishProgress(
  p: ScanProgress,
  prev: EnginesCache | null | undefined,
  next: EnginesCache,
  now: Date,
): ScanProgress {
  const done = withLocalLlms(withEngines(p, next.engines), next.localLlms);
  return {
    ...done,
    state: 'done',
    finishedAt: now.toISOString(),
    found: engineNames(next).length,
    ...diffEngines(prev, next),
  };
}

/** 캐시만 있고 아직 스캔 전 (앱 시작 직후 즉시 표시용) */
export function progressFromCache(cache: EnginesCache | null | undefined): ScanProgress {
  if (!cache) return { state: 'idle', engines: [], found: 0, added: [], removed: [] };
  const base: ScanProgress = {
    state: 'idle',
    engines: PROGRESS_TARGETS.map((name) => ({ name, label: engineLabel(name), state: 'missing' as const })),
    found: engineNames(cache).length,
    added: [],
    removed: [],
    finishedAt: cache.scannedAt,
  };
  return withLocalLlms(withEngines(base, cache.engines), cache.localLlms);
}

/** 5A.5 엔진별 상태 확인 제한 시간: 넘기면 fallback 값으로 끝낸다 (느린 엔진 하나가 전체를 막지 않음) */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    (t as { unref?: () => void }).unref?.();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}
