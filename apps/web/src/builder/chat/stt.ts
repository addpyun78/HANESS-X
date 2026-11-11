import {
  chooseSttProvider,
  SttProviderSchema,
  type SpeechToText,
  type SttAvailability,
  type SttChoice,
  type SttProvider,
} from '@harness-x/protocol';
import { BrowserSpeechToText, findRecognition } from '@harness-x/stt-browser';
import { HarnessApiClient, resolveToken } from '../../api/client.js';

/**
 * 대화 탭의 음성 입력 연결
 * - 설정 `stt.provider` = local | browser | off (없으면 기본 규칙: local 감지 시 local, 아니면 browser + 동의)
 * - local: PC 안 whisper.cpp — 화면은 녹음만 하고 하네스 서버(POST /api/stt/transcribe)가 변환
 * - browser: stt-browser 플러그인 (첫 녹음 전 동의)
 */

export const STT_SETTING_KEY = 'hx.stt.provider';

/** 화면이 쓰는 STT (동의가 필요 없는 구현은 needsConsent=false) */
export interface SttHandle extends SpeechToText {
  readonly needsConsent: boolean;
  grantConsent(): void;
}

export function readSttSetting(): SttProvider | undefined {
  try {
    const r = SttProviderSchema.safeParse(globalThis.localStorage?.getItem(STT_SETTING_KEY));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeSttSetting(p: SttProvider | undefined): void {
  try {
    if (p) globalThis.localStorage?.setItem(STT_SETTING_KEY, p);
    else globalThis.localStorage?.removeItem(STT_SETTING_KEY);
  } catch {
    // 저장 실패 → 기본 규칙
  }
}

/** PC 안 음성 인식: MediaRecorder로 녹음 → 하네스 서버가 whisper.cpp로 변환 */
export class LocalHttpSpeechToText implements SttHandle {
  readonly id = 'local';
  readonly needsConsent = false;
  onPartial?: ((text: string) => void) | undefined;
  onFinal?: ((text: string) => void) | undefined;
  onError?: ((err: Error) => void) | undefined;
  onLevel?: ((level: number) => void) | undefined;
  private rec: MediaRecorder | undefined;
  private chunks: Blob[] = [];

  constructor(private readonly client: HarnessApiClient) {}

  grantConsent(): void {}

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => this.chunks.push(e.data);
    this.rec = rec;
    rec.start();
  }

  async stop(): Promise<void> {
    const rec = this.rec;
    if (!rec) return;
    this.rec = undefined;
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.stop();
    rec.stream.getTracks().forEach((t) => t.stop());
    await done;
    const buf = new Uint8Array(await new Blob(this.chunks).arrayBuffer());
    let bin = '';
    for (const b of buf) bin += String.fromCharCode(b);
    try {
      const r = await this.client.request<{ text?: string; message?: string }>('/api/stt/transcribe', {
        method: 'POST',
        body: JSON.stringify({ audio: btoa(bin) }),
      });
      if (r.text) this.onFinal?.(r.text);
      else if (r.message) throw new Error(r.message);
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/** 브라우저 음성 인식 (stt-browser 플러그인) */
export function browserStt(): SttHandle {
  return new BrowserSpeechToText();
}

/** 지금 쓸 수 있는 STT 확인 (local = GET /api/stt/status, browser = Web Speech API) */
export async function sttAvailability(client?: HarnessApiClient): Promise<SttAvailability> {
  let local = false;
  if (client) {
    try {
      local = (await client.request<{ local?: boolean }>('/api/stt/status')).local === true;
    } catch {
      local = false;
    }
  }
  return { local, browser: !!findRecognition() };
}

/** 설정·감지 결과로 STT 만들기 (off면 undefined → 마이크 버튼 숨김) */
export async function resolveStt(): Promise<{ choice: SttChoice; stt?: SttHandle }> {
  const token = resolveToken();
  const client = token ? new HarnessApiClient({ token }) : undefined;
  const provider = readSttSetting();
  const choice = chooseSttProvider(provider ? { provider } : {}, await sttAvailability(client));
  if (choice.provider === 'local' && client) return { choice, stt: new LocalHttpSpeechToText(client) };
  if (choice.provider === 'browser') return { choice, stt: browserStt() };
  return { choice };
}
