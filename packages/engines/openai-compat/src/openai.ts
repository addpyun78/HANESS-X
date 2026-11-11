import { randomUUID } from 'node:crypto';
import {
  ModelApiError,
  type ChatMessage,
  type ModelClient,
  type ModelRequest,
  type ModelTurn,
  type ToolCallRequest,
} from '@harness-x/kernel';
import { parseArgs, postSse, trimSlash, type FetchLike } from './http.js';

/**
 * /v1/chat/completions 스트리밍 클라이언트 (OpenAI·Ollama·DeepSeek·LM Studio·vLLM 등)
 */

export interface OpenAIChatClientOptions {
  /** 예: http://127.0.0.1:11434/v1 (끝에 /chat/completions 를 붙인다) */
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** response_format: json_object 를 요청 (JSON 모드 폴백용) */
  jsonMode?: boolean;
  temperature?: number;
  fetch?: FetchLike;
}

interface ChunkToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface Chunk {
  choices?: {
    index?: number;
    delta?: { content?: string | null; tool_calls?: ChunkToolCall[] };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
  error?: { message?: string };
}

export function toOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: {
            name: c.name,
            arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}),
          },
        })),
      };
    }
    // T-101 1D.4·1D.5 그림은 data URL image_url 블록 (Ollama 비전 모델도 같은 모양)
    if (m.role === 'user' && m.media?.length)
      return {
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          ...m.media
            .filter((x) => x.kind === 'image')
            .map((x) => ({ type: 'image_url', image_url: { url: `data:${x.mime};base64,${x.data}` } })),
        ],
      };
    return { role: m.role, content: m.content };
  });
}

export class OpenAIChatClient implements ModelClient {
  constructor(readonly opts: OpenAIChatClientOptions) {}

  async complete(req: ModelRequest): Promise<ModelTurn> {
    const o = this.opts;
    const body: Record<string, unknown> = {
      model: o.model,
      messages: toOpenAIMessages(req.messages),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.tools.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (o.jsonMode) body.response_format = { type: 'json_object' };
    if (o.temperature !== undefined) body.temperature = o.temperature;
    const headers: Record<string, string> = { ...o.headers };
    if (o.apiKey) headers.authorization = `Bearer ${o.apiKey}`;

    let text = '';
    let finishReason: string | undefined;
    let usage: ModelTurn['usage'];
    const calls = new Map<number, { id?: string; name: string; args: string }>();

    for await (const msg of postSse(`${trimSlash(o.baseUrl)}/chat/completions`, headers, body, {
      signal: req.signal,
      fetch: o.fetch,
    })) {
      if (msg.data === '[DONE]') break;
      let chunk: Chunk;
      try {
        chunk = JSON.parse(msg.data) as Chunk;
      } catch {
        continue;
      }
      if (chunk.error) throw new ModelApiError(chunk.error.message ?? 'stream error');
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
        const cached = chunk.usage.prompt_tokens_details?.cached_tokens;
        if (cached) usage.cacheReadTokens = cached;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const d = choice.delta;
      if (d?.content) {
        text += d.content;
        req.onText?.(d.content);
      }
      for (const tc of d?.tool_calls ?? []) {
        const idx = tc.index ?? calls.size;
        const cur = calls.get(idx) ?? { name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(idx, cur);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    const toolCalls: ToolCallRequest[] = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, c]) => c.name)
      .map(([, c]) => ({
        id: c.id ?? `call_${randomUUID().slice(0, 8)}`,
        name: c.name,
        arguments: parseArgs(c.args),
      }));
    const turn: ModelTurn = { text, toolCalls };
    if (usage) turn.usage = usage;
    if (finishReason) turn.finishReason = finishReason;
    return turn;
  }
}
