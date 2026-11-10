import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ── 13.6 토큰 파일 접근 금지 가드 ────────────────────────────

export class TokenFileAccessError extends Error {
  readonly code = 'HX_TOKEN_FILE_FORBIDDEN';
  constructor(readonly path: string) {
    super(`구독 토큰 파일 접근 금지: ${path} (하네스는 엔진 토큰을 읽지도 저장하지도 않습니다)`);
  }
}

export interface TokenGuardOptions {
  /** 홈 폴더 목록 (기본: os.homedir()) */
  homes?: string[];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

interface TokenRule {
  dir: string;
  match(base: string): boolean;
}

/** 엔진 CLI가 구독 로그인 토큰을 두는 위치 */
export function tokenFileRules(opts: TokenGuardOptions = {}): TokenRule[] {
  const env = opts.env ?? process.env;
  const homes = opts.homes ?? [homedir()];
  const claudeCreds = (b: string) => b.startsWith('.credentials'); // .credentials.json 및 백업·변형
  const codexAuth = (b: string) => b === 'auth.json';
  const geminiCreds = (b: string) => b === 'oauth_creds.json';
  const rules: TokenRule[] = [];
  for (const h of homes) {
    rules.push({ dir: resolve(h, '.claude'), match: claudeCreds });
    rules.push({ dir: resolve(h, '.codex'), match: codexAuth });
    rules.push({ dir: resolve(h, '.gemini'), match: geminiCreds });
  }
  if (env.CLAUDE_CONFIG_DIR) rules.push({ dir: resolve(env.CLAUDE_CONFIG_DIR), match: claudeCreds });
  if (env.CODEX_HOME) rules.push({ dir: resolve(env.CODEX_HOME), match: codexAuth });
  return rules;
}

function toPathString(p: unknown): string | undefined {
  if (typeof p === 'string') return p;
  if (Buffer.isBuffer(p)) return p.toString('utf8');
  if (p instanceof URL) return p.protocol === 'file:' ? fileURLToPath(p) : undefined;
  return undefined; // 파일 디스크립터 등
}

/** 경로가 토큰 파일인지 (내용은 읽지 않는다. 심볼릭 링크는 realpath로 확인) */
export function isTokenFilePath(p: unknown, opts: TokenGuardOptions = {}): boolean {
  const s = toPathString(p);
  if (!s) return false;
  const win = (opts.platform ?? process.platform) === 'win32';
  const norm = (x: string) => (win ? x.toLowerCase() : x);
  const candidates = [resolve(s)];
  try {
    candidates.push(fs.realpathSync.native(s));
  } catch {
    /* 없는 파일 */
  }
  const rules = tokenFileRules(opts);
  return candidates.some((c) =>
    rules.some((r) => norm(dirname(c)) === norm(r.dir) && r.match(norm(basename(c)))),
  );
}

export function assertNotTokenFile(p: unknown, opts: TokenGuardOptions = {}): void {
  if (isTokenFilePath(p, opts)) throw new TokenFileAccessError(toPathString(p) ?? String(p));
}

type AnyFn = (...args: unknown[]) => unknown;
const READ_FNS = [
  'readFileSync',
  'readFile',
  'openSync',
  'open',
  'createReadStream',
  'copyFileSync',
  'copyFile',
];
const PROMISE_READ_FNS = ['readFile', 'open', 'copyFile'];
const CALLBACK_FNS = new Set(['readFile', 'open', 'copyFile']);
let guardInstalled = false;

/**
 * 프로세스 전체의 fs 읽기 함수를 감싸 토큰 파일 접근 시 TokenFileAccessError를 던진다.
 * 반환값을 호출하면 원래대로 되돌린다.
 */
export function installTokenFileGuard(opts: TokenGuardOptions = {}): () => void {
  if (guardInstalled) return () => {};
  guardInstalled = true;
  const restore: (() => void)[] = [];
  const wrap = (target: Record<string, unknown>, name: string, isPromise: boolean) => {
    const orig = target[name] as AnyFn;
    if (typeof orig !== 'function') return;
    const guarded = function (this: unknown, ...args: unknown[]) {
      if (isTokenFilePath(args[0], opts)) {
        const err = new TokenFileAccessError(toPathString(args[0]) ?? '');
        if (isPromise) return Promise.reject(err);
        const cb = args[args.length - 1];
        if (CALLBACK_FNS.has(name) && typeof cb === 'function') {
          process.nextTick(cb as AnyFn, err);
          return undefined;
        }
        throw err;
      }
      return orig.apply(this, args);
    };
    Object.defineProperty(guarded, 'name', { value: name });
    target[name] = guarded;
    restore.push(() => {
      target[name] = orig;
    });
  };
  const fsObj = fs as unknown as Record<string, unknown>;
  for (const n of READ_FNS) wrap(fsObj, n, false);
  for (const n of PROMISE_READ_FNS) wrap(fs.promises as unknown as Record<string, unknown>, n, true);
  syncBuiltinESMExports(); // `import { readFileSync } from 'node:fs'` 에도 반영
  return () => {
    for (const r of restore) r();
    syncBuiltinESMExports();
    guardInstalled = false;
  };
}
