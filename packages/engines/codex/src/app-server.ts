import type { EventBody } from '@harness-x/kernel';
import { classifyCodexError, classifyCodexErrorInfo } from './errors.js';
import type { RpcNotification } from './jsonrpc.js';

/**
 * 15.2 codex app-server 알림 → HarnessEvent 본문
 *
 * item/agentMessage/delta      → assistant_text (partial)
 * item/completed agentMessage  → assistant_text
 * item/started commandExecution·mcpToolCall·dynamicToolCall → tool_call
 * item/completed 〃            → tool_result
 * item/completed fileChange    → file_change (변경 파일마다)
 * thread/tokenUsage/updated    → (모아 두었다가) turn/completed 때 usage
 * error                        → error (willRetry면 retryable)
 * turn/completed               → usage + turn_end
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** account/rateLimits/read 응답·rateLimits/updated 알림 → 0~1 사용률 (가장 높은 창 기준) */
export function quotaRatioFromRateLimits(res: unknown): number | undefined {
  if (!isObj(res)) return undefined;
  const snaps: unknown[] = [];
  if (isObj(res.rateLimits)) snaps.push(res.rateLimits);
  if (isObj(res.rateLimitsByLimitId)) snaps.push(...Object.values(res.rateLimitsByLimitId));
  const pcts: number[] = [];
  for (const s of snaps) {
    if (!isObj(s)) continue;
    for (const w of [s.primary, s.secondary])
      if (isObj(w) && typeof w.usedPercent === 'number' && Number.isFinite(w.usedPercent))
        pcts.push(w.usedPercent);
  }
  if (!pcts.length) return undefined;
  return Math.min(1, Math.max(0, Math.max(...pcts) / 100));
}

/** 15.3 쿼터 조회 결과 → usage 이벤트 본문 (모델 호출 없음, 토큰 0) */
export function rateLimitsToUsage(res: unknown): EventBody {
  const quotaRatio = quotaRatioFromRateLimits(res);
  return {
    type: 'usage',
    inputTokens: 0,
    outputTokens: 0,
    ...(quotaRatio !== undefined ? { quotaRatio } : {}),
  };
}

function fileChangeBodies(item: Json): EventBody[] {
  if (item.status !== 'completed' || !Array.isArray(item.changes)) return [];
  const out: EventBody[] = [];
  for (const c of item.changes) {
    if (!isObj(c) || !str(c.path)) continue;
    const kind = isObj(c.kind) ? c.kind : {};
    const diff = str(c.diff) ? { diff: str(c.diff) } : {};
    if (kind.type === 'add') out.push({ type: 'file_change', path: str(c.path), change: 'create', ...diff });
    else if (kind.type === 'delete')
      out.push({ type: 'file_change', path: str(c.path), change: 'delete', ...diff });
    else if (str(kind.move_path))
      out.push({
        type: 'file_change',
        path: str(kind.move_path),
        change: 'rename',
        fromPath: str(c.path),
        ...diff,
      });
    else out.push({ type: 'file_change', path: str(c.path), change: 'modify', ...diff });
  }
  return out;
}

export class CodexAppServerMapper {
  threadId: string | undefined;
  turnId: string | undefined;
  quotaRatio: number | undefined;
  private usage = { input: 0, output: 0, cached: 0, seen: false };
  private errorEmitted = false;
  ended = false;

  handle(n: RpcNotification): EventBody[] {
    const p = isObj(n.params) ? n.params : {};
    switch (n.method) {
      case 'thread/started':
        if (isObj(p.thread) && str(p.thread.id)) this.threadId = str(p.thread.id);
        return [];
      case 'turn/started':
        if (isObj(p.turn) && str(p.turn.id)) this.turnId = str(p.turn.id);
        return [];
      case 'item/agentMessage/delta':
        return str(p.delta) ? [{ type: 'assistant_text', text: str(p.delta), partial: true }] : [];
      case 'item/started':
        return isObj(p.item) ? this.itemStarted(p.item) : [];
      case 'item/completed':
        return isObj(p.item) ? this.itemCompleted(p.item) : [];
      case 'thread/tokenUsage/updated': {
        const last = isObj(p.tokenUsage) && isObj(p.tokenUsage.last) ? p.tokenUsage.last : undefined;
        if (last) {
          this.usage.input += num(last.inputTokens);
          this.usage.output += num(last.outputTokens);
          this.usage.cached += num(last.cachedInputTokens);
          this.usage.seen = true;
        }
        return [];
      }
      case 'account/rateLimits/updated': {
        const q = quotaRatioFromRateLimits(p);
        if (q !== undefined) this.quotaRatio = q;
        return [];
      }
      case 'error':
        return this.error(p);
      case 'turn/completed':
        return this.turnCompleted(p);
      default:
        return [];
    }
  }

  private itemStarted(item: Json): EventBody[] {
    const id = str(item.id);
    if (!id) return [];
    switch (item.type) {
      case 'commandExecution':
        return [
          { type: 'tool_call', callId: id, tool: 'shell', input: { command: item.command, cwd: item.cwd } },
        ];
      case 'mcpToolCall':
        return [
          {
            type: 'tool_call',
            callId: id,
            tool: `${str(item.server)}.${str(item.tool)}`,
            input: item.arguments ?? {},
          },
        ];
      case 'dynamicToolCall':
        return [
          { type: 'tool_call', callId: id, tool: str(item.tool) || 'tool', input: item.arguments ?? {} },
        ];
      default:
        return [];
    }
  }

  private itemCompleted(item: Json): EventBody[] {
    const id = str(item.id);
    switch (item.type) {
      case 'agentMessage':
        return str(item.text) ? [{ type: 'assistant_text', text: str(item.text), partial: false }] : [];
      case 'commandExecution':
        return [
          {
            type: 'tool_result',
            callId: id,
            ok: item.status === 'completed' && (item.exitCode ?? 0) === 0,
            output: { output: str(item.aggregatedOutput), exitCode: item.exitCode ?? null },
          },
        ];
      case 'mcpToolCall':
        return [
          {
            type: 'tool_result',
            callId: id,
            ok: item.status === 'completed' && !item.error,
            output: item.error ?? item.result ?? null,
          },
        ];
      case 'dynamicToolCall':
        return [
          { type: 'tool_result', callId: id, ok: item.success === true, output: item.contentItems ?? null },
        ];
      case 'fileChange':
        return fileChangeBodies(item);
      default:
        return [];
    }
  }

  private error(p: Json): EventBody[] {
    const err = isObj(p.error) ? p.error : {};
    const message = str(err.message) || 'codex 오류';
    const willRetry = p.willRetry === true;
    const code = classifyCodexErrorInfo(err.codexErrorInfo) ?? classifyCodexError(message).code;
    if (!willRetry) this.errorEmitted = true;
    return [
      { type: 'error', code, message, retryable: willRetry || code === 'rate_limited' || code === 'network' },
    ];
  }

  private turnCompleted(p: Json): EventBody[] {
    const turn = isObj(p.turn) ? p.turn : {};
    const out: EventBody[] = [];
    if (this.usage.seen || this.quotaRatio !== undefined)
      out.push({
        type: 'usage',
        inputTokens: this.usage.input,
        outputTokens: this.usage.output,
        ...(this.usage.seen ? { cacheReadTokens: this.usage.cached } : {}),
        ...(this.quotaRatio !== undefined ? { quotaRatio: this.quotaRatio } : {}),
      });
    if (turn.status === 'completed') out.push({ type: 'turn_end', reason: 'completed' });
    else if (turn.status === 'interrupted') out.push({ type: 'turn_end', reason: 'interrupted' });
    else {
      if (!this.errorEmitted) {
        const err = isObj(turn.error) ? turn.error : {};
        const message = str(err.message) || `turn ${str(turn.status) || 'failed'}`;
        const code = classifyCodexErrorInfo(err.codexErrorInfo) ?? classifyCodexError(message).code;
        out.push({ type: 'error', code, message, retryable: code === 'rate_limited' || code === 'network' });
      }
      out.push({ type: 'turn_end', reason: 'error' });
    }
    this.ended = true;
    return out;
  }
}
