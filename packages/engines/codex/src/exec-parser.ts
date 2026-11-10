import { tryJson, type EventBody, type LineParser } from '@harness-x/kernel';
import { classifyCodexError } from './errors.js';

/**
 * 15.4 폴백: codex exec --json NDJSON 파서
 *
 * thread.started            → 세션(스레드) ID
 * item.started  command_execution·mcp_tool_call → tool_call
 * item.completed agent_message → assistant_text, command_execution·mcp_tool_call → tool_result,
 *                file_change → file_change
 * turn.completed            → usage + turn_end(completed)
 * turn.failed / error       → error (+ turn_end(error))
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const FILE_KIND: Record<string, 'create' | 'delete' | 'modify'> = {
  add: 'create',
  delete: 'delete',
  update: 'modify',
};

export class CodexExecParser implements LineParser {
  private thread: string | undefined;
  private lastError: string | undefined;

  sessionId(): string | undefined {
    return this.thread;
  }

  line(line: string): EventBody[] {
    const ev = tryJson(line);
    if (!isObj(ev)) return [];
    switch (ev.type) {
      case 'thread.started':
        if (str(ev.thread_id)) this.thread = str(ev.thread_id);
        return [];
      case 'item.started':
        return isObj(ev.item) ? this.started(ev.item) : [];
      case 'item.completed':
        return isObj(ev.item) ? this.completed(ev.item) : [];
      case 'turn.completed': {
        const u = isObj(ev.usage) ? ev.usage : {};
        return [
          {
            type: 'usage',
            inputTokens: num(u.input_tokens),
            outputTokens: num(u.output_tokens),
            cacheReadTokens: num(u.cached_input_tokens),
          },
          { type: 'turn_end', reason: 'completed' },
        ];
      }
      case 'turn.failed': {
        const message = (isObj(ev.error) && str(ev.error.message)) || this.lastError || 'codex turn failed';
        const c = classifyCodexError(message);
        return [
          { type: 'error', code: c.code, message, retryable: c.retryable },
          { type: 'turn_end', reason: 'error' },
        ];
      }
      case 'error': {
        // 재시도 안내("Reconnecting... 1/5")도 여기로 온다: 턴은 끝내지 않는다
        const message = str(ev.message) || 'codex error';
        this.lastError = message;
        const c = classifyCodexError(message);
        const retrying = /reconnecting|retrying/i.test(message);
        return [{ type: 'error', code: c.code, message, retryable: retrying || c.retryable }];
      }
      default:
        return [];
    }
  }

  private started(item: Json): EventBody[] {
    const id = str(item.id);
    if (!id) return [];
    if (item.type === 'command_execution')
      return [{ type: 'tool_call', callId: id, tool: 'shell', input: { command: item.command } }];
    if (item.type === 'mcp_tool_call')
      return [
        {
          type: 'tool_call',
          callId: id,
          tool: `${str(item.server)}.${str(item.tool)}`,
          input: item.arguments ?? {},
        },
      ];
    return [];
  }

  private completed(item: Json): EventBody[] {
    const id = str(item.id);
    switch (item.type) {
      case 'agent_message':
        return str(item.text) ? [{ type: 'assistant_text', text: str(item.text), partial: false }] : [];
      case 'command_execution':
        return [
          {
            type: 'tool_result',
            callId: id,
            ok: item.status === 'completed' && (item.exit_code ?? 0) === 0,
            output: { output: str(item.aggregated_output), exitCode: item.exit_code ?? null },
          },
        ];
      case 'mcp_tool_call':
        return [
          {
            type: 'tool_result',
            callId: id,
            ok: item.status === 'completed' && !item.error,
            output: item.error ?? item.result ?? null,
          },
        ];
      case 'file_change':
        if (item.status !== 'completed' || !Array.isArray(item.changes)) return [];
        return item.changes
          .filter((c): c is Json => isObj(c) && !!str(c.path))
          .map((c) => ({
            type: 'file_change' as const,
            path: str(c.path),
            change: FILE_KIND[str(c.kind)] ?? 'modify',
          }));
      default:
        return [];
    }
  }

  finish(exitCode: number | null, stderr: string): EventBody[] {
    const message = this.lastError || stderr.trim() || `codex exec가 결과 없이 종료됨 (exit ${exitCode})`;
    const c = classifyCodexError(message);
    return [
      {
        type: 'error',
        code: c.code === 'unknown' ? 'engine_crashed' : c.code,
        message,
        retryable: c.retryable,
      },
      { type: 'turn_end', reason: 'error' },
    ];
  }
}
