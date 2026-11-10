import { tryJson, type EventBody, type LineParser } from '@harness-x/kernel';
import { classifyClaudeError, classifyClaudeErrorField } from './errors.js';

/**
 * 14.2 claude -p --output-format stream-json --verbose 줄 파서 → HarnessEvent 본문
 *
 * system/init          → 세션 ID 수집 (이벤트 없음)
 * assistant text       → assistant_text
 * assistant tool_use   → tool_call
 * user tool_result     → tool_result (+ Write/Edit 성공 시 file_change)
 * result               → usage, (오류면 error), turn_end
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((c) => (isObj(c) && typeof c.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
  return '';
}

export class ClaudeStreamParser implements LineParser {
  private session: string | undefined;
  private tools = new Map<string, { name: string; input: unknown }>();
  /** 마지막 assistant 메시지에 붙은 error 필드 */
  private lastErrorField: string | undefined;
  /** rate_limit_event의 구독 한도 사용률 최댓값 (0~1) */
  private quotaRatio: number | undefined;
  /** system/init에서 본 MCP 서버·도구 (14.4 확인용) */
  initTools: string[] = [];
  mcpServers: { name: string; status: string }[] = [];

  sessionId(): string | undefined {
    return this.session;
  }

  line(line: string): EventBody[] {
    const msg = tryJson(line);
    if (!isObj(msg)) return [];
    if (typeof msg.session_id === 'string' && msg.session_id) this.session = msg.session_id;
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          if (Array.isArray(msg.tools))
            this.initTools = msg.tools.filter((t): t is string => typeof t === 'string');
          if (Array.isArray(msg.mcp_servers))
            this.mcpServers = msg.mcp_servers.filter(isObj).map((s) => ({
              name: String(s.name),
              status: String(s.status),
            }));
        }
        return [];
      case 'assistant':
        return this.assistant(msg);
      case 'user':
        return this.user(msg);
      case 'rate_limit_event':
        this.rateLimit(msg);
        return [];
      case 'result':
        return this.result(msg);
      default:
        return [];
    }
  }

  private assistant(msg: Json): EventBody[] {
    const out: EventBody[] = [];
    if (typeof msg.error === 'string') this.lastErrorField = msg.error;
    const content = isObj(msg.message) && Array.isArray(msg.message.content) ? msg.message.content : [];
    for (const c of content) {
      if (!isObj(c)) continue;
      if (c.type === 'text' && typeof c.text === 'string' && c.text) {
        out.push({ type: 'assistant_text', text: c.text, partial: false });
      } else if (c.type === 'tool_use' && typeof c.id === 'string' && typeof c.name === 'string') {
        this.tools.set(c.id, { name: c.name, input: c.input });
        out.push({ type: 'tool_call', callId: c.id, tool: c.name, input: c.input ?? {} });
      }
    }
    return out;
  }

  private user(msg: Json): EventBody[] {
    const out: EventBody[] = [];
    const content = isObj(msg.message) && Array.isArray(msg.message.content) ? msg.message.content : [];
    for (const c of content) {
      if (!isObj(c) || c.type !== 'tool_result' || typeof c.tool_use_id !== 'string') continue;
      const ok = c.is_error !== true;
      const text = toolResultText(c.content);
      out.push({ type: 'tool_result', callId: c.tool_use_id, ok, output: text || c.content });
      const call = this.tools.get(c.tool_use_id);
      if (ok && call && FILE_TOOLS.has(call.name) && isObj(call.input)) {
        const path = call.input.file_path ?? call.input.notebook_path;
        if (typeof path === 'string' && path)
          out.push({
            type: 'file_change',
            path,
            change: call.name === 'Write' && /created/i.test(text) ? 'create' : 'modify',
          });
      }
    }
    return out;
  }

  private rateLimit(msg: Json): void {
    const info = isObj(msg.rate_limit_info) ? msg.rate_limit_info : {};
    const windows = isObj(info.unifiedWindows) ? Object.values(info.unifiedWindows) : [];
    const ratios = windows
      .map((w) => (isObj(w) && typeof w.utilization === 'number' ? w.utilization : NaN))
      .filter((n) => Number.isFinite(n));
    if (ratios.length) this.quotaRatio = Math.min(1, Math.max(0, ...ratios));
  }

  private result(msg: Json): EventBody[] {
    const out: EventBody[] = [];
    const u = isObj(msg.usage) ? msg.usage : {};
    out.push({
      type: 'usage',
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      ...(u.cache_read_input_tokens !== undefined ? { cacheReadTokens: num(u.cache_read_input_tokens) } : {}),
      ...(typeof msg.total_cost_usd === 'number' ? { costUsd: Math.max(0, msg.total_cost_usd) } : {}),
      ...(this.quotaRatio !== undefined ? { quotaRatio: this.quotaRatio } : {}),
    });
    const subtype = typeof msg.subtype === 'string' ? msg.subtype : '';
    if (subtype === 'error_max_turns') {
      out.push({ type: 'turn_end', reason: 'max_turns' });
    } else if (msg.is_error === true || subtype.startsWith('error')) {
      const text =
        (typeof msg.result === 'string' && msg.result) ||
        (Array.isArray(msg.errors) ? msg.errors.map(String).join('\n') : '') ||
        subtype ||
        'claude 실행 오류';
      let { code, retryable } = classifyClaudeError(text);
      if (code === 'unknown' && this.lastErrorField) code = classifyClaudeErrorField(this.lastErrorField);
      if (code === 'rate_limited') retryable = true;
      out.push({ type: 'error', code, message: text, retryable });
      out.push({ type: 'turn_end', reason: 'error' });
    } else {
      out.push({ type: 'turn_end', reason: 'completed' });
    }
    return out;
  }

  /** result 줄 없이 끝났을 때: stderr로 분류 */
  finish(exitCode: number | null, stderr: string): EventBody[] {
    const text = stderr.trim() || `claude가 결과 없이 종료됨 (exit ${exitCode})`;
    const c = classifyClaudeError(text);
    return [
      {
        type: 'error',
        code: c.code === 'unknown' ? 'engine_crashed' : c.code,
        message: text,
        retryable: c.retryable,
      },
      { type: 'turn_end', reason: 'error' },
    ];
  }
}
