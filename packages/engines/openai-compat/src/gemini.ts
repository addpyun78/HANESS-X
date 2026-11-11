import { randomUUID } from 'node:crypto';
import {
  ModelApiError,
  type ChatMessage,
  type ModelClient,
  type ModelRequest,
  type ModelTurn,
  type ToolCallRequest,
} from '@harness-x/kernel';
import { postSse, trimSlash, type FetchLike } from './http.js';

/**
 * Gemini API 스트리밍 클라이언트 (POST /v1beta/models/{model}:streamGenerateContent?alt=sse)
 */

export interface GeminiClientOptions {
  /** 기본 https://generativelanguage.googleapis.com */
  baseUrl?: string;
  model: string;
  apiKey: string;
  fetch?: FetchLike;
}

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

type Part = Record<string, unknown>;

const LOCAL_ID = 'gemini_';
/** 모델이 준 호출 ID만 되돌려 보낸다 (하네스가 만든 ID는 생략) */
function geminiId(id: string): { id?: string } {
  return id.startsWith(LOCAL_ID) ? {} : { id };
}

export function toGeminiContents(messages: ChatMessage[]): {
  systemInstruction?: { parts: Part[] };
  contents: { role: 'user' | 'model'; parts: Part[] }[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const contents: { role: 'user' | 'model'; parts: Part[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user')
      contents.push({
        role: 'user',
        parts: [
          ...(m.media ?? []).map((x) => ({ inlineData: { mimeType: x.mime, data: x.data } })),
          { text: m.content },
        ],
      });
    else if (m.role === 'assistant') {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? [])
        parts.push({ functionCall: { ...geminiId(c.id), name: c.name, args: c.arguments ?? {} } });
      contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] });
    } else {
      const part: Part = {
        functionResponse: { ...geminiId(m.toolCallId), name: m.name, response: { content: m.content } },
      };
      const prev = contents.at(-1);
      if (prev?.role === 'user' && prev.parts.every((p) => 'functionResponse' in p)) prev.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    }
  }
  return system ? { systemInstruction: { parts: [{ text: system }] }, contents } : { contents };
}

interface GeminiChunk {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        thought?: boolean;
        functionCall?: { id?: string; name: string; args?: unknown };
      }[];
    };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  error?: { message?: string; code?: number };
}

export class GeminiClient implements ModelClient {
  constructor(readonly opts: GeminiClientOptions) {}

  async complete(req: ModelRequest): Promise<ModelTurn> {
    const o = this.opts;
    const body: Record<string, unknown> = { ...toGeminiContents(req.messages) };
    if (req.tools.length)
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    const url = `${trimSlash(o.baseUrl ?? GEMINI_BASE_URL)}/v1beta/models/${encodeURIComponent(o.model)}:streamGenerateContent?alt=sse`;

    let text = '';
    let finishReason: string | undefined;
    let usage: ModelTurn['usage'];
    const toolCalls: ToolCallRequest[] = [];
    for await (const msg of postSse(url, { 'x-goog-api-key': o.apiKey }, body, {
      signal: req.signal,
      fetch: o.fetch,
    })) {
      let c: GeminiChunk;
      try {
        c = JSON.parse(msg.data) as GeminiChunk;
      } catch {
        continue;
      }
      if (c.error) throw new ModelApiError(c.error.message ?? 'stream error', c.error.code, msg.data);
      const cand = c.candidates?.[0];
      for (const p of cand?.content?.parts ?? []) {
        if (p.functionCall)
          toolCalls.push({
            id: p.functionCall.id ?? `${LOCAL_ID}${randomUUID().slice(0, 8)}`,
            name: p.functionCall.name,
            arguments: p.functionCall.args ?? {},
          });
        else if (p.text && !p.thought) {
          text += p.text;
          req.onText?.(p.text);
        }
      }
      if (cand?.finishReason) finishReason = cand.finishReason;
      // usageMetadata는 누적값이라 마지막 것을 쓴다
      if (c.usageMetadata) {
        usage = {
          inputTokens: c.usageMetadata.promptTokenCount ?? 0,
          outputTokens: c.usageMetadata.candidatesTokenCount ?? 0,
        };
        if (c.usageMetadata.cachedContentTokenCount)
          usage.cacheReadTokens = c.usageMetadata.cachedContentTokenCount;
      }
    }
    const turn: ModelTurn = { text, toolCalls };
    if (usage) turn.usage = usage;
    if (finishReason) turn.finishReason = finishReason;
    return turn;
  }
}
