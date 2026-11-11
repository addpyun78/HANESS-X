import type { SpeechToText } from '@harness-x/protocol';

/**
 * T-100 P4-B.6 stt-browser: 브라우저 음성 인식(Web Speech API, ko-KR).
 * 처음 쓸 때 "목소리가 브라우저 회사 서버로 전송될 수 있어요" 안내 + 동의 버튼.
 * 동의 전에는 start()가 거부되고 마이크도 열지 않는다.
 * DOM·Node 어느 쪽에도 의존하지 않도록 인식기 생성자와 동의 저장소를 주입받는다.
 */

export const STT_BROWSER_ID = 'browser';
export const STT_BROWSER_LANG = 'ko-KR';
export const CONSENT_NOTICE = '목소리가 브라우저 회사 서버로 전송될 수 있어요';
export const CONSENT_KEY = 'hx.stt.browser.consent';

/** Web Speech API에서 쓰는 부분만 (SpeechRecognition / webkitSpeechRecognition) */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: RecognitionResultEventLike) => void) | null;
  onerror: ((ev: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
export interface RecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
export type RecognitionCtor = new () => RecognitionLike;

/** 동의 저장소 (기본: localStorage) */
export interface ConsentStore {
  get(): boolean;
  set(value: boolean): void;
}

export class SttConsentRequiredError extends Error {
  readonly code = 'STT_CONSENT_REQUIRED';
  constructor() {
    super(`음성 입력 동의가 필요해요: ${CONSENT_NOTICE}`);
  }
}

export class SttUnavailableError extends Error {
  readonly code = 'STT_UNAVAILABLE';
  constructor() {
    super('이 브라우저는 음성 인식을 지원하지 않아요');
  }
}

/** 전역(window)에서 인식기 생성자 찾기 */
export function findRecognition(g: unknown = globalThis): RecognitionCtor | undefined {
  const w = g as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition;
}

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage 동의 저장소 (못 쓰면 메모리) */
export function localConsentStore(key = CONSENT_KEY): ConsentStore {
  let mem = false;
  const ls = (): KeyValueStorage | undefined => {
    try {
      return (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    } catch {
      return undefined;
    }
  };
  return {
    get: () => ls()?.getItem(key) === 'yes' || mem,
    set: (v) => {
      mem = v;
      try {
        if (v) ls()?.setItem(key, 'yes');
        else ls()?.removeItem(key);
      } catch {
        // 저장 실패 → 이번 세션 메모리만
      }
    },
  };
}

export interface BrowserSttOptions {
  /** 인식기 생성자 (기본: window.SpeechRecognition / webkitSpeechRecognition) */
  recognition?: RecognitionCtor | undefined;
  consent?: ConsentStore;
  lang?: string;
}

export class BrowserSpeechToText implements SpeechToText {
  readonly id = STT_BROWSER_ID;
  onPartial?: ((text: string) => void) | undefined;
  onFinal?: ((text: string) => void) | undefined;
  onError?: ((err: Error) => void) | undefined;
  onLevel?: ((level: number) => void) | undefined;
  private readonly Ctor: RecognitionCtor | undefined;
  private readonly consent: ConsentStore;
  private readonly lang: string;
  private rec: RecognitionLike | undefined;
  private ended: (() => void) | undefined;

  constructor(o: BrowserSttOptions = {}) {
    this.Ctor = 'recognition' in o ? o.recognition : findRecognition();
    this.consent = o.consent ?? localConsentStore();
    this.lang = o.lang ?? STT_BROWSER_LANG;
  }

  get available(): boolean {
    return !!this.Ctor;
  }

  /** 처음 녹음 전에 안내를 보여 줘야 하는지 */
  get needsConsent(): boolean {
    return !this.consent.get();
  }

  /** 사용자가 [동의] 버튼을 눌렀을 때 */
  grantConsent(): void {
    this.consent.set(true);
  }

  revokeConsent(): void {
    this.consent.set(false);
  }

  get recording(): boolean {
    return !!this.rec;
  }

  async start(): Promise<void> {
    if (!this.Ctor) throw new SttUnavailableError();
    if (!this.consent.get()) throw new SttConsentRequiredError();
    if (this.rec) return;
    const rec = new this.Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let partial = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (r.isFinal) this.onFinal?.(text);
        else partial += (partial ? ' ' : '') + text;
      }
      if (partial) this.onPartial?.(partial);
    };
    rec.onerror = (ev) => this.onError?.(new Error(ev.message || ev.error || '음성 인식 오류'));
    rec.onend = () => {
      this.rec = undefined;
      this.ended?.();
      this.ended = undefined;
    };
    this.rec = rec;
    rec.start();
  }

  /** 종료: 마지막 확정 결과(onFinal)가 온 뒤 끝난다 */
  async stop(): Promise<void> {
    const rec = this.rec;
    if (!rec) return;
    await new Promise<void>((resolve) => {
      this.ended = resolve;
      rec.stop();
    });
  }
}

/** 하네스 플러그인 진입점 (브라우저 쪽 구현이라 서버에서는 할 일이 없다) */
export function activate(ctx: { log(message: string): void }): void {
  ctx.log('stt-browser: 브라우저 음성 인식(ko-KR) 제공 — 동의 후 사용');
}
