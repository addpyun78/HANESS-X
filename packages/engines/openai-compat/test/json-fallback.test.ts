import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@harness-x/protocol';
import { ollamaEngine, parseJsonModeReply } from '../src/index.js';
import { openaiText, openaiToolCall, startMock } from './mock-server.js';

async function collect(it: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

type Body = {
  tools?: unknown;
  response_format?: unknown;
  messages: { role: string; content: string | null }[];
};

describe('JSON 모드 폴백', () => {
  let dir: string;
  let mock: Awaited<ReturnType<typeof startMock>> | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hx-json-'));
    writeFileSync(join(dir, 'note.txt'), 'mango');
  });
  afterEach(async () => {
    await mock?.close();
    mock = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('응답 해석: tool_calls·tool 단축형·코드펜스·final·JSON 아님', () => {
    const names = new Set(['read_file']);
    expect(
      parseJsonModeReply('{"tool_calls":[{"name":"read_file","arguments":{"path":"a"}}]}', names).toolCalls,
    ).toMatchObject([{ name: 'read_file', arguments: { path: 'a' } }]);
    expect(
      parseJsonModeReply('```json\n{"tool":"read_file","arguments":"{\\"path\\":\\"b\\"}"}\n```', names)
        .toolCalls,
    ).toMatchObject([{ name: 'read_file', arguments: { path: 'b' } }]);
    expect(parseJsonModeReply('Sure! {"final":"done"}', names)).toEqual({ text: 'done', toolCalls: [] });
    expect(parseJsonModeReply('그냥 텍스트', names)).toEqual({ text: '그냥 텍스트', toolCalls: [] });
  });

  it('auto: 서버가 "does not support tools"로 거절하면 JSON 모드로 전환해 루프 완료', async () => {
    mock = await startMock((req) => {
      const b = req.body as Body;
      if (b.tools) return { status: 400, text: '{"error":{"message":"gemma:2b does not support tools"}}' };
      const last = b.messages.at(-1)!;
      if (last.role === 'user' && last.content?.startsWith('Tool result'))
        return { chunks: openaiText(JSON.stringify({ final: `answer: ${last.content.split('\n')[1]}` })) };
      return {
        chunks: openaiText(
          JSON.stringify({ tool_calls: [{ name: 'read_file', arguments: { path: 'note.txt' } }] }),
        ),
      };
    });
    const engine = ollamaEngine({ baseUrl: mock.url, defaultModel: 'gemma:2b' });
    const events = await collect(engine.run({ sessionId: 's', prompt: 'note.txt?', cwd: dir }).events);

    expect(events.find((e) => e.type === 'tool_call')).toMatchObject({
      tool: 'read_file',
      input: { path: 'note.txt' },
    });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: true, output: 'mango' });
    expect(events.filter((e) => e.type === 'assistant_text' && !e.partial).at(-1)).toMatchObject({
      text: 'answer: mango',
    });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'completed' });
    expect(events.some((e) => e.type === 'error')).toBe(false);

    // 요청: 1) 네이티브(거절) 2) JSON 모드 3) JSON 모드 (전환 유지)
    expect(mock.requests).toHaveLength(3);
    const [, j1, j2] = mock.requests.map((r) => r.body as Body);
    for (const b of [j1!, j2!]) {
      expect(b.tools).toBeUndefined();
      expect(b.response_format).toEqual({ type: 'json_object' });
      expect(b.messages[0]!.role).toBe('system');
      expect(b.messages[0]!.content).toContain('read_file');
      expect(b.messages.some((m) => m.role === 'tool')).toBe(false);
    }
    expect(j2!.messages.at(-2)).toMatchObject({ role: 'assistant' });
    expect(JSON.parse(j2!.messages.at(-2)!.content!)).toEqual({
      tool_calls: [{ name: 'read_file', arguments: { path: 'note.txt' } }],
    });
  });

  it('toolMode json은 처음부터 JSON 모드, native는 폴백 없이 오류', async () => {
    mock = await startMock((req) =>
      (req.body as Body).tools
        ? { status: 400, text: 'model does not support tools' }
        : { chunks: openaiText('{"final":"hi"}') },
    );
    const json = ollamaEngine({ baseUrl: mock.url, defaultModel: 'm', toolMode: 'json' });
    const ev = await collect(json.run({ sessionId: 's', prompt: 'x', cwd: dir }).events);
    expect(ev.at(-1)).toMatchObject({ reason: 'completed' });
    expect(mock.requests).toHaveLength(1);

    const native = ollamaEngine({ baseUrl: mock.url, defaultModel: 'm', toolMode: 'native' });
    const ev2 = await collect(native.run({ sessionId: 's', prompt: 'x', cwd: dir }).events);
    expect(ev2[0]).toMatchObject({ type: 'error', code: 'invalid_request' });
  });

  it('도구 지원 모델은 auto에서도 네이티브 유지', async () => {
    mock = await startMock((_r, n) =>
      n === 0 ? { chunks: openaiToolCall('c', 'list_dir', {}) } : { chunks: openaiText('ok') },
    );
    const engine = ollamaEngine({ baseUrl: mock.url, defaultModel: 'm' });
    await collect(engine.run({ sessionId: 's', prompt: 'x', cwd: dir }).events);
    expect(mock.requests.every((r) => (r.body as Body).tools)).toBe(true);
  });
});
