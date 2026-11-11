import type { AssetHealth, NodeSummary } from './schema.js';

/**
 * P4-A.8 자산 건강 상태: ready | needs-login | disabled | outdated
 * 여러 원인이 겹치면 더 나쁜 쪽: disabled > needs-login > outdated > ready
 */

const SEVERITY: Record<AssetHealth, number> = { ready: 0, outdated: 1, 'needs-login': 2, disabled: 3 };

export function worstHealth(...hs: (AssetHealth | undefined)[]): AssetHealth {
  let out: AssetHealth = 'ready';
  for (const h of hs) if (h && SEVERITY[h] > SEVERITY[out]) out = h;
  return out;
}

/** 플러그인: 로더 상태가 active가 아니면 disabled */
export function pluginHealth(p: { state?: string | undefined }): AssetHealth {
  return !p.state || p.state === 'active' ? 'ready' : 'disabled';
}

export interface EngineHealthInput {
  installed: boolean;
  /** engine-scanner status */
  status?: 'ok' | 'outdated' | 'unknown' | undefined;
  login?: 'loggedIn' | 'loggedOut' | 'unknown' | undefined;
  /** 사용자가 설정에서 끈 엔진 */
  userDisabled?: boolean | undefined;
}

/** 엔진: 미설치·사용자 끔 → disabled, 로그아웃 → needs-login, 최소 버전 미달 → outdated */
export function engineHealth(e: EngineHealthInput): AssetHealth {
  if (!e.installed || e.userDisabled) return 'disabled';
  return worstHealth(
    e.login === 'loggedOut' ? 'needs-login' : 'ready',
    e.status === 'outdated' ? 'outdated' : 'ready',
  );
}

/**
 * 에이전트·파이프라인: 노드가 쓰는 엔진의 상태 중 가장 나쁜 것.
 * 'auto'·미지정 엔진은 무시, 인벤토리에 없는 엔진은 disabled (엔진 탐지 결과가 아예 없으면 판단하지 않음).
 */
export function pipelineHealth(
  nodes: readonly NodeSummary[],
  engines: ReadonlyMap<string, AssetHealth>,
): AssetHealth {
  if (engines.size === 0) return 'ready';
  const hs = nodes
    .map((n) => n.engine)
    .filter((e): e is string => !!e && e !== 'auto')
    .map((e) => engines.get(e) ?? 'disabled');
  return worstHealth(...hs);
}
