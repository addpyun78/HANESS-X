import { tryJson, type EventBody, type LineParser } from '@harness-x/kernel';
import type { EngineErrorCode } from '@harness-x/protocol';
import { AGY_LOGIN_HINT, classifyAgyError, classifyAgyStructured, parseAgyErrorLine } from './errors.js';

/**
 * 16.2 agy -p --output-format stream-json 출력 파서
 *
 * init                                  → 대화(conversation) ID
 * step_update agent_response text_delta → assistant_text (partial), 단계 DONE 때 합친 텍스트(final)
 * step_update tool ACTIVE/DONE          → tool_call / tool_result (result의 denied_actions면 ok=false)
 * result                                → usage + turn_end (status SUCCESS 외에는 error)
 * AGY_ERROR: {...} (stdout·stderr)       → 구조화 에러 분류
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export class AgyStreamParser implements LineParser {
  private conversation: string | undefined;
  private texts = new Map<number, string>();
  private toolsStarted = new Set<number>();
  /** DONE된 도구 단계: 거부 여부는 result에서 알 수 있어 그때까지 보류 */
  private pendingResults: { callId: string; tool: string; output: unknown }[] = [];
  private errorEmitted = false;
  /** 텍스트 출력 모드(비 JSON 줄) 대비 */
  private plain: string[] = [];

  sessionId(): string | undefined {
    return this.conversation;
  }

  line(line: string): EventBody[] {
    const structured = parseAgyErrorLine(line);
    if (structured) return this.structuredError(structured);
    const ev = tryJson(line);
    if (!isObj(ev)) {
      if (line.trim()) this.plain.push(line);
      return [];
    }
    if (str(ev.conversation_id)) this.conversation = str(ev.conversation_id);
    switch (ev.event) {
      case 'step_update':
        return isObj(ev.step_update) ? this.step(ev.step_update) : [];
      case 'result':
        return isObj(ev.result) ? this.result(ev.result) : [];
      case 'error':
        return this.structuredError(isObj(ev.error) ? ev.error : { message: str(ev.message) });
      default:
        return [];
    }
  }

  stderrLine(line: string): EventBody[] {
    const structured = parseAgyErrorLine(line);
    return structured ? this.structuredError(structured) : [];
  }

  private flushTools(denied: Set<string> = new Set()): EventBody[] {
    const out: EventBody[] = this.pendingResults.map((r) =>
      denied.has(norm(r.tool))
        ? { type: 'tool_result' as const, callId: r.callId, ok: false, output: { denied: true } }
        : { type: 'tool_result' as const, callId: r.callId, ok: true, output: r.output },
    );
    this.pendingResults = [];
    return out;
  }

  private step(s: Json): EventBody[] {
    if (str(s.conversation_id)) this.conversation = str(s.conversation_id);
    const idx = typeof s.step_index === 'number' ? s.step_index : -1;
    const out: EventBody[] = [];
    if (s.step_type === 'agent_response') {
      out.push(...this.flushTools());
      const delta = str(s.text_delta);
      if (delta) {
        this.texts.set(idx, (this.texts.get(idx) ?? '') + delta);
        if (delta.trim()) out.push({ type: 'assistant_text', text: delta, partial: true });
      }
      if (s.state === 'DONE') {
        const full = (this.texts.get(idx) ?? '').trim();
        if (full) out.push({ type: 'assistant_text', text: full, partial: false });
        this.texts.delete(idx);
      }
    } else if (s.step_type === 'tool') {
      const info = isObj(s.tool_info) ? s.tool_info : {};
      const tool = str(s.tool_name) || str(info.name) || 'tool';
      const callId = `${this.conversation ?? 'agy'}:${idx}`;
      if (!this.toolsStarted.has(idx)) {
        this.toolsStarted.add(idx);
        out.push(...this.flushTools());
        out.push({ type: 'tool_call', callId, tool, input: info.parameters ?? {} });
      }
      if (s.state === 'DONE')
        this.pendingResults.push({ callId, tool, output: info.output ?? info.result ?? null });
      else if (s.state === 'ERROR' || s.state === 'FAILED' || s.state === 'CANCELED') {
        out.push({
          type: 'tool_result',
          callId,
          ok: false,
          output: { state: s.state, error: info.error ?? null },
        });
      }
    }
    return out;
  }

  private result(r: Json): EventBody[] {
    const denied = new Set<string>();
    if (Array.isArray(r.denied_actions))
      for (const d of r.denied_actions)
        if (isObj(d)) {
          if (str(d.display_name)) denied.add(norm(str(d.display_name)));
          if (str(d.tool_name)) denied.add(norm(str(d.tool_name)));
        }
    const out = this.flushTools(denied);
    const u = isObj(r.usage) ? r.usage : {};
    out.push({
      type: 'usage',
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      cacheReadTokens: num(u.cache_read_tokens),
    });
    const status = str(r.status).toUpperCase();
    if (status === 'SUCCESS') out.push({ type: 'turn_end', reason: 'completed' });
    else if (/CANCEL/.test(status)) out.push({ type: 'turn_end', reason: 'interrupted' });
    else {
      if (!this.errorEmitted) {
        const message =
          str(r.error) || (isObj(r.error) ? str(r.error.message) : '') || `agy status ${status || 'unknown'}`;
        out.push(this.errorBody(classifyAgyError(message), message));
      }
      out.push({ type: 'turn_end', reason: status === 'TIMEOUT' ? 'max_turns' : 'error' });
    }
    return out;
  }

  private errorBody(c: { code: EngineErrorCode; retryable: boolean }, message: string): EventBody {
    this.errorEmitted = true;
    return {
      type: 'error',
      code: c.code,
      message: c.code === 'auth_required' ? `${message}\n${AGY_LOGIN_HINT}` : message,
      retryable: c.retryable,
    };
  }

  private structuredError(e: Json): EventBody[] {
    if (this.errorEmitted) return [];
    const message = str(e.message) || str(e.code) || JSON.stringify(e);
    return [this.errorBody(classifyAgyStructured(e), message)];
  }

  finish(exitCode: number | null, stderr: string): EventBody[] {
    const out = this.flushTools();
    // 텍스트 모드 출력이면 그대로 최종 텍스트로
    if (!this.errorEmitted && exitCode === 0 && this.plain.length) {
      out.push({ type: 'assistant_text', text: this.plain.join('\n'), partial: false });
      out.push({ type: 'turn_end', reason: 'completed' });
      return out;
    }
    if (!this.errorEmitted) {
      const message = stderr.trim() || this.plain.join('\n') || `agy가 결과 없이 종료됨 (exit ${exitCode})`;
      const c = classifyAgyError(message);
      out.push(
        this.errorBody(c.code === 'unknown' ? { code: 'engine_crashed', retryable: false } : c, message),
      );
    }
    out.push({ type: 'turn_end', reason: 'error' });
    return out;
  }
}
