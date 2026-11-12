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
 * Anthropic Messages API 스트리밍 클라이언트 (POST /v1/messages, stream: true)
 */

export interface AnthropicClientOptions {
  /** 기본 https://api.anthropic.com */
  baseUrl?: string;
  model: string;
  apiKey: string;
  maxTokens?: number;
  version?: string;
  fetch?: FetchLike;
}

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

type Block = Record<string, unknown>;

export function toAnthropicMessages(messages: ChatMessage[]): {
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string | Block[] }[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const out: { role: 'user' | 'assistant'; content: string | Block[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user')
      out.push({
        role: 'user',
        content: m.media?.length
          ? [
              ...m.media.map((x) =>
                x.kind === 'pdf'
                  ? {
                      type: 'document',
                      source: { type: 'base64', media_type: 'application/pdf', data: x.data },
                    }
                  : { type: 'image', source: { type: 'base64', media_type: x.mime, data: x.data } },
              ),
              { type: 'text', text: m.content },
            ]
          : m.content,
      });
    else if (m.role === 'assistant') {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? [])
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments ?? {} });
      out.push({ role: 'assistant', content: blocks.length ? blocks : '' });
    } else {
      const block: Block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const prev = out.at(-1);
      // 연속된 도구 결과는 한 user 메시지로 묶는다
      if (
        prev?.role === 'user' &&
        Array.isArray(prev.content) &&
        prev.content.every((b) => b.type === 'tool_result')
      )
        prev.content.push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return system ? { system, messages: out } : { messages: out };
}

export class AnthropicClient implements ModelClient {
  constructor(readonly opts: AnthropicClientOptions) {}

  async complete(req: ModelRequest): Promise<ModelTurn> {
    const o = this.opts;
    const conv = toAnthropicMessages(req.messages);
    const body: Record<string, unknown> = {
      model: o.model,
      max_tokens: o.maxTokens ?? 8192,
      ...conv,
      stream: true,
    };
    if (req.tools.length)
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    const headers = { 'x-api-key': o.apiKey, 'anthropic-version': o.version ?? '2023-06-01' };

    let text = '';
    let finishReason: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheRead = 0;
    let sawUsage = false;
    const blocks = new Map<number, { id: string; name: string; json: string }>();

    for await (const msg of postSse(
      `${trimSlash(o.baseUrl ?? ANTHROPIC_BASE_URL)}/v1/messages`,
      headers,
      body,
      {
        signal: req.signal,
        fetch: o.fetch,
      },
    )) {
      let d: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        d = JSON.parse(msg.data);
      } catch {
        continue;
      }
      const type = (d.type as string | undefined) ?? msg.event;
      if (type === 'error') throw new ModelApiError(d.error?.message ?? 'stream error', undefined, msg.data);
      if (type === 'message_start') {
        const u = d.message?.usage ?? {};
        inputTokens = u.input_tokens ?? 0;
        outputTokens = u.output_tokens ?? 0;
        cacheRead = u.cache_read_input_tokens ?? 0;
        sawUsage = true;
      } else if (type === 'content_block_start') {
        const b = d.content_block ?? {};
        if (b.type === 'tool_use') blocks.set(d.index, { id: b.id, name: b.name, json: '' });
        else if (b.type === 'text' && b.text) {
          text += b.text;
          req.onText?.(b.text);
        }
      } else if (type === 'content_block_delta') {
        const delta = d.delta ?? {};
        if (delta.type === 'text_delta' && delta.text) {
          text += delta.text;
          req.onText?.(delta.text);
        } else if (delta.type === 'input_json_delta') {
          const b = blocks.get(d.index);
          if (b) b.json += delta.partial_json ?? '';
        }
      } else if (type === 'message_delta') {
        if (d.delta?.stop_reason) finishReason = d.delta.stop_reason;
        if (d.usage?.output_tokens !== undefined) outputTokens = d.usage.output_tokens;
        if (d.usage?.input_tokens) inputTokens = d.usage.input_tokens;
        sawUsage = true;
      } else if (type === 'message_stop') break;
    }

    const toolCalls: ToolCallRequest[] = [...blocks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, b]) => ({ id: b.id, name: b.name, arguments: parseArgs(b.json) }));
    const turn: ModelTurn = { text, toolCalls };
    if (sawUsage)
      turn.usage = { inputTokens, outputTokens, ...(cacheRead ? { cacheReadTokens: cacheRead } : {}) };
    if (finishReason) turn.finishReason = finishReason;
    return turn;
  }
}
