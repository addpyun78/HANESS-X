import { readEnginesCache, type EnginesCache } from '@harness-x/engine-scanner';
import { engineHealth } from './health.js';
import type { EngineAsset } from './schema.js';

/**
 * P4-A.4 엔진 수집: engine-scanner 결과(~/.harness-x/engines.json)
 * + 로그인 상태 + 구독/API 모드(engines-settings.yaml) + 쿼터 여유.
 * 엔진 자격 증명 파일은 읽지 않는다 — 로그인 상태는 호출자가 넘긴 값(auth-status)만 쓴다.
 */

export interface EngineFacts {
  /** 엔진 id(claude-code·codex·antigravity …) → 로그인 상태 (모르면 생략 = unknown) */
  login?: Readonly<Record<string, 'loggedIn' | 'loggedOut' | 'unknown'>>;
  /** 엔진 id → 인증 방식 (engines-settings.yaml의 mode) */
  mode?: Readonly<Record<string, 'subscription' | 'apiKey'>>;
  /** 엔진 id → 쿼터 (UsageAggregator 요약) */
  quota?: Readonly<Record<string, { level: 'ok' | 'warning' | 'danger' | 'unknown'; ratio?: number }>>;
  /** 사용자가 끈 엔진 id */
  disabled?: readonly string[];
}

/** 스캐너 바이너리 이름 → 하네스 엔진 id (파이프라인 engine 칸에 쓰는 이름) */
export const ENGINE_ID_BY_BINARY: Readonly<Record<string, string>> = {
  claude: 'claude-code',
  'claude-agent-acp': 'claude-code',
  'codex-acp': 'codex',
  agy: 'antigravity',
};

export function engineIdOf(binary: string): string {
  return ENGINE_ID_BY_BINARY[binary] ?? binary;
}

export function hostOf(location: string): EngineAsset['host'] {
  if (location === 'windows') return 'windows';
  if (location.startsWith('wsl:')) return 'wsl';
  return 'other';
}

export function collectEngines(cache: EnginesCache | null, facts: EngineFacts = {}): EngineAsset[] {
  if (!cache) return [];
  return cache.engines.map((e) => {
    const id = engineIdOf(e.name);
    const login = facts.login?.[id] ?? 'unknown';
    const q = facts.quota?.[id];
    // 스캐너는 PATH에서 찾은 엔진만 기록한다 (버전 확인 실패여도 설치는 된 것)
    const installed = true;
    return {
      id,
      binary: e.name,
      installed,
      version: e.version,
      location: e.location,
      host: hostOf(e.location),
      login,
      mode: facts.mode?.[id] ?? 'unknown',
      quota: q
        ? { level: q.level, ...(q.ratio !== undefined ? { ratio: q.ratio } : {}) }
        : { level: 'unknown' },
      health: engineHealth({
        installed,
        status: e.status,
        login,
        userDisabled: facts.disabled?.includes(id),
      }),
    };
  });
}

/** engines.json을 읽어 수집 (없거나 깨지면 빈 목록) */
export function collectEnginesFromFile(file?: string, facts: EngineFacts = {}): EngineAsset[] {
  return collectEngines(file ? readEnginesCache(file) : readEnginesCache(), facts);
}
