import { randomUUID } from 'node:crypto';
import {
  ModelApiError,
  type ChatMessage,
  type ModelClient,
  type ModelRequest,
  type ModelTurn,
  type ToolCallRequest,
  type ToolSpec,
} from '@harness-x/kernel';

/**
 * 도구 호출(function calling) 미지원 모델용 JSON 모드 폴백.
 * 도구 목록과 응답 규약을 system 프롬프트로 넣고, 모델의 JSON 답을 tool_calls/최종 답으로 해석한다.
 * 대화 이력의 tool_calls·tool 결과는 일반 assistant/user 메시지로 바꿔 보낸다.
 */

export function jsonProtocolPrompt(tools: ToolSpec[]): string {
  const list = tools
    .map((t) => `- ${t.name}: ${t.description}\n  parameters (JSON Schema): ${JSON.stringify(t.parameters)}`)
    .join('\n');
  return [
    'You cannot call functions natively. Instead, reply with exactly ONE JSON object and nothing else.',
    'To call tools: {"tool_calls": [{"name": "<tool name>", "arguments": { ... }}]}',
    'To give the final answer: {"final": "<answer text>"}',
    'After a tool call you will receive its result in the next user message.',
    '',
    'Available tools:',
    list || '(none)',
  ].join('\n');
}

function toJsonModeMessages(messages: ChatMessage[], tools: ToolSpec[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const proto = jsonProtocolPrompt(tools);
  const sys = messages.find((m) => m.role === 'system');
  out.push({ role: 'system', content: sys ? `${sys.content}\n\n${proto}` : proto });
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.toolCalls?.length
          ? JSON.stringify({ tool_calls: m.toolCalls.map((c) => ({ name: c.name, arguments: c.arguments })) })
          : JSON.stringify({ final: m.content }),
      });
    } else if (m.role === 'tool') {
      out.push({ role: 'user', content: `Tool result (${m.name}, id ${m.toolCallId}):\n${m.content}` });
    } else out.push(m);
  }
  return out;
}

function extractJson(text: string): unknown {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  const body = fenced ? fenced[1]! : t;
  try {
    return JSON.parse(body);
  } catch {
    const a = body.indexOf('{');
    const b = body.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(body.slice(a, b + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/** JSON 모드 답 → 도구 호출 / 최종 텍스트. JSON이 아니면 원문을 최종 답으로 본다 */
export function parseJsonModeReply(
  text: string,
  toolNames: Set<string>,
): Pick<ModelTurn, 'text' | 'toolCalls'> {
  const v = extractJson(text) as Record<string, unknown> | undefined;
  if (!v || typeof v !== 'object') return { text, toolCalls: [] };
  const raw: unknown[] = Array.isArray(v.tool_calls)
    ? v.tool_calls
    : typeof v.tool === 'string'
      ? [{ name: v.tool, arguments: v.arguments }]
      : typeof v.name === 'string' && toolNames.has(v.name)
        ? [v]
        : [];
  const toolCalls: ToolCallRequest[] = raw
    .filter(
      (c): c is { name: string; arguments?: unknown } =>
        !!c && typeof (c as { name?: unknown }).name === 'string',
    )
    .map((c) => ({
      id: `json_${randomUUID().slice(0, 8)}`,
      name: c.name,
      arguments: typeof c.arguments === 'string' ? safeParse(c.arguments) : (c.arguments ?? {}),
    }));
  if (toolCalls.length) return { text: '', toolCalls };
  const final = v.final ?? v.answer ?? v.content;
  return { text: typeof final === 'string' ? final : text, toolCalls: [] };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** inner는 도구 없이(가능하면 JSON 모드로) 호출된다 */
export function jsonFallbackClient(inner: ModelClient): ModelClient {
  return {
    async complete(req: ModelRequest): Promise<ModelTurn> {
      const turn = await inner.complete({
        messages: toJsonModeMessages(req.messages, req.tools),
        tools: [],
        ...(req.signal ? { signal: req.signal } : {}),
      });
      const parsed = parseJsonModeReply(turn.text, new Set(req.tools.map((t) => t.name)));
      if (parsed.text) req.onText?.(parsed.text);
      const out: ModelTurn = { ...parsed };
      if (turn.usage) out.usage = turn.usage;
      if (turn.finishReason) out.finishReason = turn.finishReason;
      return out;
    },
  };
}

/** 서버가 "도구 미지원"으로 거절했는지 (Ollama: "... does not support tools") */
export function isToolsUnsupported(err: unknown): boolean {
  if (!(err instanceof ModelApiError) || err.status === undefined || err.status < 400 || err.status >= 500)
    return false;
  return /does not support tools|tools? (?:are |is )?not supported|unsupported.{0,20}tool|tool.{0,20}unsupported|function calling is not/i.test(
    `${err.message} ${err.body ?? ''}`,
  );
}

/**
 * 자동 모드: 먼저 네이티브 도구 호출을 쓰고, 서버가 도구 미지원으로 거절하면
 * 그 요청부터 JSON 모드 폴백으로 바꿔 계속 쓴다.
 */
export function autoToolModeClient(
  native: ModelClient,
  json: ModelClient,
): ModelClient & { mode(): 'native' | 'json' } {
  let mode: 'native' | 'json' = 'native';
  const fallback = jsonFallbackClient(json);
  return {
    mode: () => mode,
    async complete(req) {
      if (mode === 'json' || !req.tools.length) return (mode === 'json' ? fallback : native).complete(req);
      try {
        return await native.complete(req);
      } catch (err) {
        if (!isToolsUnsupported(err)) throw err;
        mode = 'json';
        return fallback.complete(req);
      }
    },
  };
}
