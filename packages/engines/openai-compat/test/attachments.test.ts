import type { Attachment } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  anthropicEngine,
  apiInputs,
  buildApiAttachmentInput,
  ollamaEngine,
  toGeminiContents,
} from '../src/index.js';
import { cleanups, drain, stable, trio } from './att-helpers.js';
import { sseEvents, startMock } from './mock-server.js';

afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const anthropicReply = () =>
  sseEvents(
    ['message_start', { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } }],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    [
      'content_block_delta',
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '봤어요' } },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    ],
    ['message_stop', { type: 'message_stop' }],
  );

describe('1D.1 API·로컬 엔진 입력 능력', () => {
  it('공급자·모델별 값', () => {
    expect(apiInputs('anthropic', 'claude-sonnet-4-5')).toEqual({
      image: true,
      pdf: true,
      audio: false,
      maxImageMB: 5,
    });
    expect(apiInputs('gemini', 'gemini-2.5-pro')).toEqual({
      image: true,
      pdf: true,
      audio: true,
      maxImageMB: 20,
    });
    expect(apiInputs('deepseek', 'deepseek-chat').image).toBe(false);
    expect(apiInputs('openai-compat', 'gpt-4o').image).toBe(true);
    expect(apiInputs('openai-compat', 'gpt-3.5-turbo').image).toBe(false);
    expect(apiInputs('openai-compat', 'llava:13b', true)).toEqual({
      image: true,
      pdf: false,
      audio: false,
      maxImageMB: 10,
    });
    expect(apiInputs('openai-compat', 'qwen3:8b', true).image).toBe(false);
    expect(ollamaEngine().inputsFor!('llama3.2-vision').image).toBe(true);
    expect(ollamaEngine().inputsFor!('qwen3').image).toBe(false);
  });
});

describe('1D.4 API 엔진: 지원 모델이면 그림·PDF를 직접 블록으로 (요청 스냅샷)', () => {
  it('Anthropic: image·document 블록 + XLSX는 글 형태', async () => {
    const t = await trio();
    const mock = await startMock(() => ({ chunks: anthropicReply() }));
    cleanups.push(() => mock.close());
    const engine = anthropicEngine({ baseUrl: mock.url, defaultModel: 'claude-sonnet-4-5' });
    const run = engine.run({
      sessionId: 's',
      prompt: '첨부를 요약해 주세요',
      cwd: t.root,
      env: { ANTHROPIC_API_KEY: 'k' },
      attachments: t.list,
    });
    const events = await drain(run.events);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
    const body = mock.requests[0]!.body as { messages: { content: { type: string }[] }[] };
    const first = body.messages[0]!;
    expect(first.content.map((b) => b.type)).toEqual(['image', 'document', 'text']);
    expect(stable(first, t.root)).toMatchSnapshot();
  });

  it('Gemini: inlineData 부분, 그림 한도를 넘으면 축소본', () => {
    const big = {
      id: 'att_aaaaaaaaaaaa',
      sha256: 'a'.repeat(64),
      originalName: '큰.png',
      sizeBytes: 30 * 1024 * 1024,
      mime: 'image/png',
      kind: 'image',
      storedPath: '/p/original.png',
      representations: [{ form: 'thumbnail', path: '/p/thumbnail.jpg', mime: 'image/jpeg', sizeBytes: 1000 }],
      warnings: [],
      status: 'ready',
    } satisfies Attachment;
    const read = (p: string) => Buffer.from(p);
    const r = buildApiAttachmentInput('보세요', [big], apiInputs('gemini', 'gemini-2.5-flash'), read);
    expect(r.media).toEqual([
      {
        kind: 'image',
        mime: 'image/jpeg',
        data: Buffer.from('/p/thumbnail.jpg').toString('base64'),
        name: '큰.png',
      },
    ]);
    const g = toGeminiContents([{ role: 'user', content: r.prompt, media: r.media }]);
    expect(g.contents[0]!.parts[0]).toEqual({
      inlineData: { mimeType: 'image/jpeg', data: Buffer.from('/p/thumbnail.jpg').toString('base64') },
    });
    expect(r.prompt).toContain('그림이 커서 줄인 그림으로 보낼게요.');
  });
});
