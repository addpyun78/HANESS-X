import {
  JudgeAnswerError,
  JudgeStateSchema,
  buildJudgeMessages,
  deviationKindQuestion,
  judgeAnswerJsonSchema,
  sameArtifactQuestion,
} from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import {
  LocalVerifier,
  LocalVerifierHttpError,
  localSettingsFrom,
  ollamaNativeBase,
  parseOllamaResponse,
} from '../src/index.js';

const state = JudgeStateSchema.parse({
  itemTitle: '모바일 앱',
  expectedPath: 'harness/mobile',
  actualPath: 'ai/mobile',
  symbols: ['MainActivity'],
});

function mockOllama(content: string, status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ model: 'm', message: { role: 'assistant', content }, done: true }), {
      status,
    });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('로컬 대체 판정기 (Ollama JSON 스키마 출력, 모킹)', () => {
  it('format=답 JSON Schema, 같은 질문 형식(메시지)으로 /api/chat 호출', async () => {
    const { f, calls } = mockOllama('{"noul":0.91,"confidence":0.7}');
    const v = new LocalVerifier({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1:8b', fetch: f });
    expect(await v.judge(sameArtifactQuestion(), state)).toEqual({ noul: 0.91, confidence: 0.7 });
    expect(calls[0]!.url).toBe('http://127.0.0.1:11434/api/chat');
    const m = buildJudgeMessages(sameArtifactQuestion(), state);
    expect(calls[0]!.body).toEqual({
      model: 'llama3.1:8b',
      stream: false,
      format: judgeAnswerJsonSchema(sameArtifactQuestion()),
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: m.system },
        { role: 'user', content: m.user },
      ],
    });
  });

  it('choice 답 파싱, 선택지 밖·비JSON·HTTP 오류', async () => {
    const ok = mockOllama('{"choice":"relocated-ok","confidence":0.6}');
    expect(await new LocalVerifier({ fetch: ok.f }).judge(deviationKindQuestion(), state)).toEqual({
      choice: 'relocated-ok',
      confidence: 0.6,
    });
    expect(ok.calls[0]!.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(() =>
      parseOllamaResponse(deviationKindQuestion(), {
        message: { content: '{"choice":"maybe","confidence":1}' },
      }),
    ).toThrow(JudgeAnswerError);
    expect(() => parseOllamaResponse(sameArtifactQuestion(), { message: { content: 'yes' } })).toThrow(
      JudgeAnswerError,
    );
    const down = mockOllama('', 500);
    await expect(new LocalVerifier({ fetch: down.f }).judge(sameArtifactQuestion(), state)).rejects.toThrow(
      LocalVerifierHttpError,
    );
  });

  it('설정', () => {
    expect(
      localSettingsFrom({ verifier: { local: { model: 'qwen', baseUrl: 'http://localhost:11434' } } }),
    ).toEqual({
      model: 'qwen',
      baseUrl: 'http://localhost:11434',
    });
    expect(ollamaNativeBase('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434');
  });
});
