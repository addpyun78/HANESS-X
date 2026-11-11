/** T-038 설정 > 엔진 — 커널 /api/engines 응답 → 카드 모델 */

export type AuthMode = 'subscription' | 'apiKey';
export type LoginState = 'loggedIn' | 'loggedOut' | 'unknown';

export interface ScanEngine {
  name: string;
  location: string;
  path: string;
  version: string | null;
  status: string;
  minVersion?: string;
  error?: string;
  /** T-101 5A.6 스캔 때 공식 상태 명령으로 확인한 로그인 상태 (모델 호출 없음) */
  login?: LoginState;
}

export interface EnginesResponse {
  scan: { scannedAt?: string; platform?: string; engines: ScanEngine[] } | null;
  settings: { engines: Record<string, { mode: AuthMode; model?: string; fallback: string[] }> };
  keys: Record<string, { masked: string } | null>;
  adapters?: { id: string; displayName: string }[];
}

export interface PingResult {
  ok: boolean;
  engineId: string;
  text: string;
  latencyMs: number;
  error?: string;
}

/** 지원 엔진 (하네스 엔진 id ↔ 스캐너가 찾는 CLI 이름) */
export interface SupportedEngine {
  id: string;
  label: string;
  bins: string[];
  installUrl: string;
}

export const SUPPORTED_ENGINES: readonly SupportedEngine[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    bins: ['claude'],
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
  },
  { id: 'codex', label: 'Codex', bins: ['codex'], installUrl: 'https://github.com/openai/codex' },
  { id: 'antigravity', label: 'Antigravity', bins: ['agy'], installUrl: 'https://antigravity.google/' },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    bins: ['gemini'],
    installUrl: 'https://github.com/google-gemini/gemini-cli',
  },
];

export interface EngineLocationView {
  location: string;
  label: string;
  path: string;
  version: string | null;
  status: string;
}

export interface EngineCardModel {
  id: string;
  label: string;
  installed: boolean;
  supported: boolean;
  installUrl?: string;
  /** 대표 버전 (첫 위치) */
  version: string | null;
  locations: EngineLocationView[];
  mode: AuthMode;
  model?: string;
  fallback: string[];
  key: { masked: string } | null;
  /** T-101 5D.7 자동 상태: 스캔이 확인한 로그인 상태 (모르면 생략 → 카드가 상태 명령으로 묻는다) */
  login?: LoginState;
}

/** windows → Windows, wsl:Ubuntu → WSL (Ubuntu) */
export function locationLabel(loc: string): string {
  if (loc === 'windows') return 'Windows';
  if (loc === 'linux') return 'Linux';
  if (loc === 'macos') return 'macOS';
  if (loc.startsWith('wsl:')) return `WSL (${loc.slice(4)})`;
  return loc;
}

export function buildEngineCards(r: EnginesResponse): EngineCardModel[] {
  const found = r.scan?.engines ?? [];
  const used = new Set<string>();
  const card = (
    id: string,
    label: string,
    entries: ScanEngine[],
    supported: SupportedEngine | undefined,
  ): EngineCardModel => {
    const s = r.settings.engines[id];
    const login = entries.map((e) => e.login).find((l) => l && l !== 'unknown');
    return {
      id,
      label,
      installed: entries.length > 0,
      supported: !!supported,
      ...(supported ? { installUrl: supported.installUrl } : {}),
      version: entries[0]?.version ?? null,
      locations: entries.map((e) => ({
        location: e.location,
        label: locationLabel(e.location),
        path: e.path,
        version: e.version,
        status: e.status,
      })),
      mode: s?.mode ?? 'subscription',
      ...(s?.model ? { model: s.model } : {}),
      fallback: s?.fallback ?? [],
      key: r.keys[id] ?? null,
      ...(login ? { login } : {}),
    };
  };
  const cards = SUPPORTED_ENGINES.map((sup) => {
    const entries = found.filter((e) => sup.bins.includes(e.name));
    for (const e of entries) used.add(e.name);
    return card(sup.id, sup.label, entries, sup);
  });
  // 지원 목록 밖에서 발견된 CLI도 카드로 (예: opencode, qwen)
  const others = [...new Set(found.filter((e) => !used.has(e.name)).map((e) => e.name))];
  for (const name of others)
    cards.push(
      card(
        name,
        name,
        found.filter((e) => e.name === name),
        undefined,
      ),
    );
  // 설치된 엔진 먼저, 미설치는 뒤(회색)
  return [...cards.filter((c) => c.installed), ...cards.filter((c) => !c.installed)];
}

export const LOGIN_LABEL: Record<LoginState, string> = {
  loggedIn: '로그인됨',
  loggedOut: '로그인 필요',
  unknown: '로그인 확인 불가',
};
