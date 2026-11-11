import { vi } from 'vitest';
import type { SttHandle } from '../src/builder/chat/stt.js';

/** 모킹 STT: start/stop 호출 기록, 말하기(say)·중간 결과(partial)·소리 크기(level) 흉내 */
class FakeStt implements SttHandle {
  readonly id = 'fake';
  onPartial?: ((text: string) => void) | undefined;
  onFinal?: ((text: string) => void) | undefined;
  onError?: ((err: Error) => void) | undefined;
  onLevel?: ((level: number) => void) | undefined;
  private consent: boolean;

  constructor(private readonly o: { needsConsent?: boolean; finalOnStop?: string }) {
    this.consent = !o.needsConsent;
  }

  get needsConsent() {
    return !this.consent;
  }

  grantConsent = vi.fn(() => {
    this.consent = true;
  });

  start = vi.fn(async () => {
    if (!this.consent) throw new Error('동의 전 녹음 금지');
  });

  stop = vi.fn(async () => {
    if (this.o.finalOnStop) this.onFinal?.(this.o.finalOnStop);
  });

  say(text: string) {
    this.onFinal?.(text);
  }

  partial(text: string) {
    this.onPartial?.(text);
  }

  level(v: number) {
    this.onLevel?.(v);
  }
}

export function fakeStt(o: { needsConsent?: boolean; finalOnStop?: string } = {}) {
  return new FakeStt(o);
}
