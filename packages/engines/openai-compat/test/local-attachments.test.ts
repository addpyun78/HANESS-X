import { afterEach, describe, expect, it } from 'vitest';
import { createApiEngine, ollamaEngine } from '../src/index.js';
import { cleanups, drain, trio } from './att-helpers.js';
import { openaiText, startMock } from './mock-server.js';

afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

describe('1D.5 로컬 LLM: 그림 가능 모델이면 그림, 아니면 글 형태', () => {
  it('Ollama llava: image_url 블록 / qwen3: 블록 없이 글 형태만', async () => {
    const t = await trio();
    const mock = await startMock(() => ({ chunks: openaiText('봤어요') }));
    cleanups.push(() => mock.close());
    for (const model of ['llava', 'qwen3']) {
      const engine = ollamaEngine({ baseUrl: `${mock.url}/v1`, toolMode: 'native' });
      await drain(
        engine.run({ sessionId: 's', prompt: '요약', cwd: t.root, model, attachments: t.list }).events,
      );
    }
    const [vision, text] = mock.requests.map((r) =>
      (r.body as { messages: { role: string; content: unknown }[] }).messages.find((m) => m.role === 'user')!,
    );
    const parts = vision!.content as { type: string; text?: string }[];
    expect(parts.map((p) => p.type)).toEqual(['text', 'image_url']);
    expect(parts[0]!.text).toContain('Quarterly sales report');
    expect(typeof text!.content).toBe('string');
    expect(text!.content).toContain('이 AI는 그림을 직접 못 봐요');
    expect(text!.content).toContain('| 동네 | 12 |');
    expect(text!.content).toContain('Quarterly sales report');
  });

  it('createApiEngine inputs 덮어쓰기', () => {
    const e = createApiEngine({
      id: 'x',
      displayName: 'x',
      provider: 'openai-compat',
      inputs: () => ({ image: true, pdf: true, audio: false, maxImageMB: 1 }),
    });
    expect(e.inputsFor!('any')).toEqual({ image: true, pdf: true, audio: false, maxImageMB: 1 });
  });
});
