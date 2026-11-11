import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  PluginManifestSchema,
  STT_TOOL_PREFIX,
  isSttTool,
  sttToolsOf,
  type SpeechToText,
} from '../src/index.js';

describe('P4-B.4 SpeechToText 인터페이스 (tool 슬롯 하위 stt)', () => {
  it('타입: start()/stop() Promise + onPartial/onFinal 글 콜백', () => {
    expectTypeOf<SpeechToText['start']>().toEqualTypeOf<() => Promise<void>>();
    expectTypeOf<SpeechToText['stop']>().toEqualTypeOf<() => Promise<void>>();
    expectTypeOf<NonNullable<SpeechToText['onPartial']>>().toEqualTypeOf<(text: string) => void>();
    expectTypeOf<NonNullable<SpeechToText['onFinal']>>().toEqualTypeOf<(text: string) => void>();
    expectTypeOf<SpeechToText['id']>().toEqualTypeOf<string>();

    // 구현체 모양 예시
    const finals: string[] = [];
    const stt: SpeechToText = {
      id: 'fake',
      start: async () => stt.onPartial?.('안녕'),
      stop: async () => stt.onFinal?.('안녕하세요'),
    };
    stt.onFinal = (t) => finals.push(t);
    return stt
      .start()
      .then(() => stt.stop())
      .then(() => expect(finals).toEqual(['안녕하세요']));
  });

  it('플러그인 슬롯: tool 이름 stt.<id> — 매니페스트 검증 통과', () => {
    expect(STT_TOOL_PREFIX).toBe('stt.');
    const m = PluginManifestSchema.parse({
      id: 'stt-local',
      version: '0.1.0',
      apiVersion: 1,
      provides: { tool: ['stt.local'] },
    });
    expect(sttToolsOf(m)).toEqual(['local']);
    expect(sttToolsOf({ provides: { tool: ['screenshot'] } })).toEqual([]);
    expect(isSttTool('stt.browser')).toBe(true);
    expect(isSttTool('stt.')).toBe(false);
    expect(isSttTool('stt')).toBe(false);
  });
});
