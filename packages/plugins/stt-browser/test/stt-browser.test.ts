import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PluginManifestSchema, sttToolsOf } from '@harness-x/protocol';
import {
  BrowserSpeechToText,
  CONSENT_NOTICE,
  STT_BROWSER_LANG,
  SttConsentRequiredError,
  SttUnavailableError,
  type ConsentStore,
  type RecognitionLike,
  type RecognitionResultEventLike,
} from '../src/index.js';

class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((ev: RecognitionResultEventLike) => void) | null = null;
  onerror: ((ev: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started++;
  }
  stop() {
    this.emit([{ text: '임장노트 검수 에이전트', final: true }]);
    this.onend?.();
  }
  emit(rs: { text: string; final: boolean }[]) {
    this.onresult?.({
      resultIndex: 0,
      results: rs.map((r) => ({ isFinal: r.final, 0: { transcript: r.text } })),
    });
  }
}

const memConsent = (v = false): ConsentStore & { value: boolean } => {
  const s = { value: v, get: () => s.value, set: (x: boolean) => void (s.value = x) };
  return s;
};

describe('P4-B.6 stt-browser (ko-KR, 첫 사용 동의)', () => {
  it('동의 전 녹음 시작 안 됨 — 인식기를 만들지도 않는다', async () => {
    FakeRecognition.instances = [];
    const consent = memConsent(false);
    const stt = new BrowserSpeechToText({ recognition: FakeRecognition, consent });
    expect(stt.needsConsent).toBe(true);
    await expect(stt.start()).rejects.toBeInstanceOf(SttConsentRequiredError);
    await expect(stt.start()).rejects.toThrow(CONSENT_NOTICE);
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(stt.recording).toBe(false);
  });

  it('동의 후 ko-KR로 녹음 → 중간 결과·확정 결과', async () => {
    FakeRecognition.instances = [];
    const consent = memConsent(false);
    const stt = new BrowserSpeechToText({ recognition: FakeRecognition, consent });
    stt.grantConsent();
    expect(consent.value).toBe(true);
    expect(stt.needsConsent).toBe(false);
    const partials: string[] = [];
    const finals: string[] = [];
    stt.onPartial = (t) => partials.push(t);
    stt.onFinal = (t) => finals.push(t);
    await stt.start();
    const rec = FakeRecognition.instances[0]!;
    expect(rec).toMatchObject({ lang: STT_BROWSER_LANG, continuous: true, interimResults: true, started: 1 });
    expect(STT_BROWSER_LANG).toBe('ko-KR');
    rec.emit([{ text: '임장노트', final: false }]);
    expect(partials).toEqual(['임장노트']);
    await stt.stop();
    expect(finals).toEqual(['임장노트 검수 에이전트']);
    expect(stt.recording).toBe(false);
  });

  it('지원 안 하는 브라우저 → 사용할 수 없음', async () => {
    const stt = new BrowserSpeechToText({ recognition: undefined, consent: memConsent(true) });
    expect(stt.available).toBe(false);
    await expect(stt.start()).rejects.toBeInstanceOf(SttUnavailableError);
  });

  it('매니페스트: tool 슬롯 하위 stt.browser, 네트워크 권한 없음', () => {
    const m = PluginManifestSchema.parse(
      JSON.parse(readFileSync(new URL('../harness-plugin.json', import.meta.url), 'utf8')),
    );
    expect(sttToolsOf(m)).toEqual(['browser']);
    expect(m.permissions).toEqual({ fs: [], net: [], shell: false });
  });
});
