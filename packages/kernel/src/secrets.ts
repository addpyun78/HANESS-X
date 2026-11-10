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
}
