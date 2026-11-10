/**
 * 18.4 엔진 선택 우선순위 리졸버: ACP → 헤드리스 CLI → API.
 * 입력은 engine-scanner 탐지 결과(EngineEntry 모양)와 인증 모드다.
 * - ACP: 엔진의 ACP 어댑터 바이너리가 있으면 (구조화된 이벤트·권한 요청·session/load 재개)
 * - 헤드리스: 공식 CLI 바이너리(claude -p, codex exec, agy …)
 * - API: apiKey 모드이고 키가 있을 때만 (구독 모드는 API로 넘어가지 않는다)
 */

export type EngineFamily = 'claude-code' | 'codex' | 'antigravity' | 'gemini';
export type EngineRoute = 'acp' | 'headless' | 'api';

export interface AcpCandidate {
  /** engine-scanner가 탐지하는 바이너리 이름 */
  bin: string;
  /** ACP 모드로 띄우는 인자 */
  args?: string[];
}

export interface FamilyCandidates {
  acp: AcpCandidate[];
  headless: string[];
  /** openai-compat 플러그인의 API 엔진 id */
  api: string;
}

export const ENGINE_CANDIDATES: Readonly<Record<EngineFamily, FamilyCandidates>> = {
  'claude-code': {
    acp: [{ bin: 'claude-agent-acp' }, { bin: 'claude-code-acp' }],
    headless: ['claude'],
    api: 'anthropic-api',
  },
  codex: { acp: [{ bin: 'codex-acp' }], headless: ['codex'], api: 'openai-compat' },
  antigravity: { acp: [], headless: ['agy'], api: 'gemini-api' },
  gemini: { acp: [{ bin: 'gemini', args: ['--experimental-acp'] }], headless: ['gemini'], api: 'gemini-api' },
};

/** engine-scanner EngineEntry와 호환되는 최소 모양 */
export interface InstalledEngine {
  name: string;
  path: string;
  location?: string;
  status?: 'ok' | 'outdated' | 'unknown';
}

export interface ResolveEngineInput {
  family: EngineFamily;
  installed: readonly InstalledEngine[];
  /** 기본 subscription */
  auth?: 'subscription' | 'apiKey';
  /** apiKey 모드에서 키체인에 키가 있는지 */
  hasApiKey?: boolean;
  /** outdated 바이너리도 후보로 (기본 false) */
  allowOutdated?: boolean;
  /** 후보 표 교체 (테스트·확장용) */
  candidates?: FamilyCandidates;
}

export interface SkipReason {
  route: EngineRoute;
  reason: string;
}

export type EngineSelection =
  | {
      route: 'acp' | 'headless';
      family: EngineFamily;
      bin: string;
      command: string;
      args: string[];
      location?: string;
      skipped: SkipReason[];
    }
  | { route: 'api'; family: EngineFamily; engineId: string; skipped: SkipReason[] }
  | { route: 'none'; family: EngineFamily; skipped: SkipReason[] };

export function resolveEngine(input: ResolveEngineInput): EngineSelection {
  const cand = input.candidates ?? ENGINE_CANDIDATES[input.family];
  const skipped: SkipReason[] = [];
  const usable = (bin: string, route: EngineRoute): InstalledEngine | undefined => {
    const hits = input.installed.filter((e) => e.name === bin);
    const ok = hits.find((e) => e.status !== 'outdated' || input.allowOutdated);
    if (!ok && hits.length) skipped.push({ route, reason: `${bin} 버전이 낮음(outdated)` });
    return ok;
  };

  if (!cand.acp.length) skipped.push({ route: 'acp', reason: `${input.family}: ACP 어댑터 없음` });
  for (const a of cand.acp) {
    const e = usable(a.bin, 'acp');
    if (e)
      return {
        route: 'acp',
        family: input.family,
        bin: a.bin,
        command: e.path,
        args: a.args ?? [],
        ...(e.location ? { location: e.location } : {}),
        skipped,
      };
  }
  if (cand.acp.length)
    skipped.push({ route: 'acp', reason: `미설치: ${cand.acp.map((a) => a.bin).join(', ')}` });

  for (const bin of cand.headless) {
    const e = usable(bin, 'headless');
    if (e)
      return {
        route: 'headless',
        family: input.family,
        bin,
        command: e.path,
        args: [],
        ...(e.location ? { location: e.location } : {}),
        skipped,
      };
  }
  skipped.push({ route: 'headless', reason: `미설치: ${cand.headless.join(', ')}` });

  if ((input.auth ?? 'subscription') !== 'apiKey') {
    skipped.push({ route: 'api', reason: '구독 모드: API로 넘어가지 않음' });
  } else if (!input.hasApiKey) {
    skipped.push({ route: 'api', reason: 'apiKey 모드인데 키체인에 키 없음' });
  } else {
    return { route: 'api', family: input.family, engineId: cand.api, skipped };
  }
  return { route: 'none', family: input.family, skipped };
}
