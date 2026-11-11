import { z } from 'zod';

/**
 * T-100 P4-B.4 음성 입력(STT) 인터페이스.
 * 플러그인 슬롯: `tool` 하위 `stt` — 매니페스트 `provides.tool`에 `stt.<id>`를 적는다
 * (예: stt-local → `stt.local`, stt-browser → `stt.browser`).
 *
 * 변환된 글은 바로 보내지 않는다: 화면은 onFinal 글을 입력창에 채우기만 하고, 전송은 사용자가 한다.
 */

/** STT 도구 이름 접두사 (`tool` 슬롯 하위 분류) */
export const STT_TOOL_PREFIX = 'stt.';

export const STT_PROVIDERS = ['local', 'browser', 'off'] as const;
export const SttProviderSchema = z.enum(STT_PROVIDERS);
export type SttProvider = z.infer<typeof SttProviderSchema>;

/** 음성 → 글 변환기. 한 번에 녹음 하나 (start → stop) */
export interface SpeechToText {
  /** 'local' | 'browser' 등 */
  readonly id: string;
  /** 녹음 시작 (마이크 권한·동의가 없으면 거부) */
  start(): Promise<void>;
  /** 녹음 종료 → 남은 변환이 끝나면 onFinal이 불린다 */
  stop(): Promise<void>;
  /** 변환 중간 결과 (말하는 동안 계속) */
  onPartial?: ((text: string) => void) | undefined;
  /** 확정된 글 (한 번 녹음에 0~여러 번) */
  onFinal?: ((text: string) => void) | undefined;
  /** 오류 (권한 거부·엔진 실패 등) */
  onError?: ((err: Error) => void) | undefined;
  /** 입력 소리 크기 0~1 (파형 표시용, 선택) */
  onLevel?: ((level: number) => void) | undefined;
}

/** 매니페스트의 tool 이름이 STT인지 */
export function isSttTool(name: string): boolean {
  return name.startsWith(STT_TOOL_PREFIX) && name.length > STT_TOOL_PREFIX.length;
}

/** 매니페스트가 제공하는 STT id 목록 (`stt.local` → `local`) */
export function sttToolsOf(m: { provides: { tool?: readonly string[] | undefined } }): string[] {
  return (m.provides.tool ?? []).filter(isSttTool).map((t) => t.slice(STT_TOOL_PREFIX.length));
}

/** 설정 `stt.provider` (없으면 기본 규칙) */
export const SttSettingsSchema = z
  .object({
    provider: SttProviderSchema.optional(),
  })
  .strict();
export type SttSettings = z.infer<typeof SttSettingsSchema>;

export interface SttAvailability {
  /** whisper.cpp 등 PC 안 변환기가 감지됨 */
  local: boolean;
  /** 브라우저 음성 인식 API가 있음 */
  browser: boolean;
}

export type SttChoice =
  | { provider: 'local' }
  | { provider: 'browser'; needsConsent: true }
  | { provider: 'off'; reason: 'setting' | 'unavailable' };

/**
 * P4-B.7 선택 규칙
 * - 설정이 off → 끔
 * - 설정이 local/browser → 그것 (사용할 수 없으면 끔)
 * - 설정 없음 → local 감지 시 local, 아니면 browser(동의 필요), 둘 다 없으면 끔
 * browser는 언제나 처음 녹음 전에 동의가 필요하다 (목소리가 브라우저 회사 서버로 갈 수 있음).
 */
export function chooseSttProvider(settings: SttSettings, available: SttAvailability): SttChoice {
  const p = settings.provider;
  if (p === 'off') return { provider: 'off', reason: 'setting' };
  const want = p ?? (available.local ? 'local' : 'browser');
  if (want === 'local')
    return available.local ? { provider: 'local' } : { provider: 'off', reason: 'unavailable' };
  return available.browser
    ? { provider: 'browser', needsConsent: true }
    : { provider: 'off', reason: 'unavailable' };
}
