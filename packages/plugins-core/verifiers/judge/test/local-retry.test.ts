import { describe, expect, it, vi } from 'vitest';
import { createLocalJudge, type FetchLike } from '../src/local.js';
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

describe('E.4 깨진 응답 → 1회 재요청 → 또 실패면 unavailable (예외 없음)', () => {
  it('첫 응답이 스키마 불일치, 재요청은 정상 → 정상 답 (호출 2회)', async () => {
    const m = mockFetch(
      () => chatReply('{"same_meaning":"maybe"}'),
      () => chatReply(JSON.stringify(good)),
    );
    await expect(createLocalJudge({ fetch: m.fetch }).ask(prompt)).resolves.toEqual(good);
    expect(m.fn).toHaveBeenCalledTimes(2);
  });

  it('두 번 다 깨짐(JSON 아님 / content 없음) → undefined, 호출 정확히 2회', async () => {
    const m = mockFetch(
      () => chatReply('I think they are the same!'),
      () => new Response(JSON.stringify({ done: true }), { status: 200 }),
    );
    await expect(createLocalJudge({ fetch: m.fetch }).ask(prompt)).resolves.toBeUndefined();
    expect(m.fn).toHaveBeenCalledTimes(2);
  });

  it('본문이 JSON이 아님 / HTTP 500 / 연결 실패 → undefined, 예외 없음', async () => {
    const notJson = mockFetch(() => new Response('<html>oops</html>', { status: 200 }));
    await expect(createLocalJudge({ fetch: notJson.fetch }).ask(prompt)).resolves.toBeUndefined();
    const http500 = mockFetch(() => chatReply('x', 500));
    await expect(createLocalJudge({ fetch: http500.fetch }).ask(prompt)).resolves.toBeUndefined();
    expect(http500.fn).toHaveBeenCalledTimes(1);
    const refused = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(createLocalJudge({ fetch: refused.fetch }).ask(prompt)).resolves.toBeUndefined();
  });
});
