import { createRequire } from 'node:module';

/**
 * T-013 인증 비밀 관리
 * - API 키는 OS 키체인에만 둔다(@napi-rs/keyring: Windows 자격 증명 관리자 / macOS Keychain / Linux keyutils·Secret Service).
 *   설정 파일·로그·디스크 어디에도 원문을 쓰지 않는다.
 * - 구독(월정액) 모드는 공식 바이너리를 수정 없이 실행할 뿐, 토큰은 읽지도 저장하지도 않는다.
 */

export const KEYCHAIN_SERVICE = 'harness-x';

// ── 13.1 키체인 ───────────────────────────────────────────────

/** 키체인 백엔드 (테스트·플랫폼별 교체 가능) */
export interface SecretBackend {
  readonly name: string;
  get(service: string, account: string): string | null;
  set(service: string, account: string, value: string): void;
  /** 삭제됐으면 true, 원래 없었으면 false */
  delete(service: string, account: string): boolean;
}

interface KeyringEntry {
  getPassword(): string | null | undefined;
  setPassword(value: string): void;
  deletePassword(): boolean;
}
interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry;
}

let keyringModule: KeyringModule | undefined;
function loadKeyring(): KeyringModule {
  // 네이티브 모듈은 실제로 쓸 때만 로드한다
  keyringModule ??= createRequire(import.meta.url)('@napi-rs/keyring') as KeyringModule;
  return keyringModule;
}

/** OS 키체인 (@napi-rs/keyring) */
export function keyringBackend(): SecretBackend {
  const entry = (service: string, account: string) => new (loadKeyring().Entry)(service, account);
  return {
    name: 'os-keyring',
    get: (s, a) => entry(s, a).getPassword() ?? null,
    set: (s, a, v) => entry(s, a).setPassword(v),
    delete: (s, a) => {
      try {
        return entry(s, a).deletePassword();
      } catch {
        return false;
      }
    },
  };
}

/** 메모리 백엔드 (테스트용, 디스크에 쓰지 않음) */
export function memoryBackend(): SecretBackend {
  const m = new Map<string, string>();
  const k = (s: string, a: string) => `${s}\u0000${a}`;
  return {
    name: 'memory',
    get: (s, a) => m.get(k(s, a)) ?? null,
    set: (s, a, v) => void m.set(k(s, a), v),
    delete: (s, a) => m.delete(k(s, a)),
  };
}

export class SecretStore {
  constructor(
    readonly backend: SecretBackend = keyringBackend(),
    readonly service = KEYCHAIN_SERVICE,
  ) {}

  get(account: string): string | null {
    return this.backend.get(this.service, account);
  }

  set(account: string, value: string): void {
    if (!value) throw new Error('빈 비밀 값은 저장할 수 없습니다');
    this.backend.set(this.service, account, value);
  }

  delete(account: string): boolean {
    return this.backend.delete(this.service, account);
  }

  has(account: string): boolean {
    return this.get(account) !== null;
  }

  // 엔진별 API 키 (계정 이름: engine:<id>)
  getApiKey(engineId: string): string | null {
    return this.get(apiKeyAccount(engineId));
  }
  setApiKey(engineId: string, key: string): void {
    this.set(apiKeyAccount(engineId), key);
  }
  deleteApiKey(engineId: string): boolean {
    return this.delete(apiKeyAccount(engineId));
  }
}

export function apiKeyAccount(engineId: string): string {
  return `engine:${engineId}`;
}

// ── 13.3 / 13.4 실행 환경변수 ─────────────────────────────────

/** 엔진 CLI가 읽는 API 키 환경변수 */
export const API_KEY_ENV_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'] as const;
export type ApiKeyEnvVar = (typeof API_KEY_ENV_VARS)[number];

/** 같은 사고(키가 구독 로그인보다 우선 적용)를 일으키는 관련 변수 — 함께 제거한다 */
export const RELATED_CREDENTIAL_ENV_VARS = [
  'ANTHROPIC_AUTH_TOKEN',
  'CODEX_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENAI_API_KEY',
] as const;

/** 엔진 id → 주입할 환경변수 */
export const ENGINE_API_KEY_ENV: Readonly<Record<string, ApiKeyEnvVar>> = {
  'claude-code': 'ANTHROPIC_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  codex: 'OPENAI_API_KEY',
  'openai-compat': 'OPENAI_API_KEY',
  antigravity: 'GEMINI_API_KEY',
  agy: 'GEMINI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export class MissingApiKeyError extends Error {
  constructor(engineId: string) {
    super(
      `'${engineId}' apiKey 모드인데 OS 키체인에 키가 없습니다 (harness-x 계정 ${apiKeyAccount(engineId)})`,
    );
  }
}

export interface EngineEnvOptions {
  engineId: string;
  mode: 'subscription' | 'apiKey';
  /** apiKey 모드에서 키를 꺼낼 저장소 */
  store?: SecretStore;
  /** 기본 process.env (변경하지 않고 복사한다) */
  baseEnv?: NodeJS.ProcessEnv;
  /** 기본 ENGINE_API_KEY_ENV[engineId] */
  apiKeyEnv?: ApiKeyEnvVar;
}

/** 모든 API 키·관련 자격 변수를 제거한 env 복사본 */
export function stripCredentialEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const drop = new Set<string>([...API_KEY_ENV_VARS, ...RELATED_CREDENTIAL_ENV_VARS]);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(baseEnv)) if (!drop.has(k.toUpperCase())) env[k] = v;
  return env;
}

/**
 * 엔진 자식 프로세스용 env.
 * - subscription: 키 변수를 모두 제거 (13.4)
 * - apiKey: 모두 제거한 뒤 이 엔진의 키 하나만 키체인에서 꺼내 주입 (13.3). 디스크에는 쓰지 않는다
 */
export function buildEngineEnv(opts: EngineEnvOptions): NodeJS.ProcessEnv {
  const env = stripCredentialEnv(opts.baseEnv ?? process.env);
  if (opts.mode === 'subscription') return env;
  const varName = opts.apiKeyEnv ?? ENGINE_API_KEY_ENV[opts.engineId];
  if (!varName)
    throw new Error(`'${opts.engineId}'의 API 키 환경변수를 알 수 없습니다 (apiKeyEnv 지정 필요)`);
  const key = (opts.store ?? new SecretStore()).getApiKey(opts.engineId);
  if (!key) throw new MissingApiKeyError(opts.engineId);
  env[varName] = key;
  return env;
}
