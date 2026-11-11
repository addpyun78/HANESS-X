import { describe, expect, it, vi } from 'vitest';
import {
  createLocalJudge,
  ollamaChatBody,
  pickLocalModel,
  probeOllama,
  type FetchLike,
} from '../src/local.js';
import { buildJudgePrompt } from '../src/questions.js';

const prompt = buildJudgePrompt({
  kind: 'path',
  itemTitle: '설정 파일 위치',
  expected: './src/config.ts',
  actual: 'src/config.ts',
});

const good = { same_meaning: 'yes', difference_kind: 'formatting-only', plain_reason: '앞의 ./ 만 달라요.' };

function chatReply(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ message: { role: 'assistant', content } }), { status });
}

function mockFetch(...replies: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let i = 0;
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const r = replies[Math.min(i++, replies.length - 1)];
    return r!();
  });
  return { fetch: f as unknown as FetchLike, calls, fn: f };
}

describe('E.3 로컬 판정기 (Ollama /api/chat)', () => {
  it('요청 스냅샷: POST /api/chat, stream:false, format=질문별 JSON 스키마, temperature 0', async () => {
    const m = mockFetch(() => chatReply(JSON.stringify(good)));
    const j = createLocalJudge({ model: 'qwen3:8b', baseUrl: 'http://127.0.0.1:11434/v1', fetch: m.fetch });
    await expect(j.ask(prompt)).resolves.toEqual(good);
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(m.calls[0]!.body).toEqual(ollamaChatBody(prompt, 'qwen3:8b'));
    expect(m.calls[0]!.body.stream).toBe(false);
    expect(m.calls[0]!.body.format).toEqual(prompt.schema);
    expect(m.calls[0]!.body).toMatchSnapshot();
    expect(j.engineId).toBe('ollama');
  });

  it('/api/tags 로 기동·모델 확인, 모델 고르기', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'llama3' }] })),
    );
    await expect(probeOllama({ fetch: f as unknown as FetchLike })).resolves.toEqual({
      running: true,
      models: ['qwen2.5-coder:7b', 'llama3'],
    });
    const down = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(probeOllama({ fetch: down as unknown as FetchLike })).resolves.toEqual({
      running: false,
      models: [],
    });
    expect(pickLocalModel('', ['llama3', 'qwen2.5-coder:7b'])).toBe('qwen2.5-coder:7b');
    expect(pickLocalModel('', ['llama3'])).toBe('llama3');
    expect(pickLocalModel('llama3:latest', ['llama3'])).toBe('llama3');
    expect(pickLocalModel('mistral', ['llama3'])).toBeUndefined();
    expect(pickLocalModel('', [])).toBeUndefined();
  });
});
