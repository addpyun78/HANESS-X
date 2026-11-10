import { JudgeAnswerError, type JudgeQuestion, type JudgeState } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import {
  JEV_MODEL,
  JevClient,
  JevConfigError,
  JevHttpError,
  jevSettingsFrom,
  parseJevResponse,
} from '../src/index.js';

const noul: JudgeQuestion = { kind: 'noul', id: 'q', prompt: '같은가?' };
const choice: JudgeQuestion = { kind: 'choice', id: 'c', prompt: '종류?', choices: ['x', 'y'] };
const state: JudgeState = {
  itemTitle: '모바일 앱',
  expectedPath: 'harness/mobile',
  actualPath: 'ai/mobile',
  candidates: [],
  fileNames: [],
  symbols: [],
};

function mockFetch(reply: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const openaiReply = (content: string) => ({
  id: 'x',
  model: JEV_MODEL,
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
});

describe('Jev 클라이언트 (모킹 응답 파싱)', () => {
  it('OpenAI 형식 응답의 content JSON을 파싱', async () => {
    const { f, calls } = mockFetch(openaiReply('{"noul":0.93,"confidence":0.88}'));
    const c = new JevClient({ endpoint: 'https://jev.example/v1/', apiKey: 'k', fetch: f });
    expect(await c.judge(noul, state)).toEqual({ noul: 0.93, confidence: 0.88 });
    expect(calls[0]!.url).toBe('https://jev.example/v1/chat/completions');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer k');
    expect(JSON.parse(String(calls[0]!.init.body)).model).toBe('jev-1.13.0');
  });

  it('```json 울타리가 있는 content, 네이티브 형식 본문', async () => {
    const fenced = mockFetch(openaiReply('```json\n{"choice":"y","confidence":0.7}\n```'));
    expect(await new JevClient({ endpoint: 'https://j/v1', fetch: fenced.f }).judge(choice, state)).toEqual({
      choice: 'y',
      confidence: 0.7,
    });
    expect(parseJevResponse(noul, { noul: 0.2, confidence: 0.95 })).toEqual({ noul: 0.2, confidence: 0.95 });
  });

  it('잘못된 답·HTTP 오류', async () => {
    expect(() => parseJevResponse(choice, openaiReply('{"choice":"z","confidence":1}'))).toThrow(
      JudgeAnswerError,
    );
    expect(() => parseJevResponse(noul, openaiReply('모르겠습니다'))).toThrow(JudgeAnswerError);
    const bad = mockFetch('rate limited', 429);
    await expect(
      new JevClient({ endpoint: 'https://j/v1', fetch: bad.f }).judge(noul, state),
    ).rejects.toThrow(JevHttpError);
  });

  it('설정: 엔드포인트·키(설정 또는 환경변수), 모델 고정', () => {
    expect(jevSettingsFrom({ verifier: { jev: { endpoint: 'https://j/v1', apiKey: 'a' } } })).toEqual({
      endpoint: 'https://j/v1',
      apiKey: 'a',
    });
    expect(jevSettingsFrom({ endpoint: 'https://j/v1', apiKeyEnv: 'MY_KEY' }, { MY_KEY: 'e' })).toEqual({
      endpoint: 'https://j/v1',
      apiKey: 'e',
    });
    expect(jevSettingsFrom({ endpoint: 'https://j/v1' }, { JEV_API_KEY: 'd' }).apiKey).toBe('d');
    expect(() => jevSettingsFrom({})).toThrow(JevConfigError);
    expect(() => jevSettingsFrom({ endpoint: 'https://j/v1', model: 'jev-2.0.0' })).toThrow(/고정/);
    expect(jevSettingsFrom({ endpoint: 'https://j/v1', model: JEV_MODEL }, {})).toEqual({
      endpoint: 'https://j/v1',
    });
  });
});
