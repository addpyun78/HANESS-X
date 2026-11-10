import type * as acp from '@agentclientprotocol/sdk';
import type { HarnessEvent, TurnEndEvent } from '@harness-x/protocol';

/**
 * ACP session/update → HarnessEvent 정규화.
 * 공통 필드(id·ts·sessionId·engineId·itemId)는 호출자가 붙인다.
 */

type Body<T> = T extends HarnessEvent ? Omit<T, 'id' | 'ts' | 'sessionId' | 'engineId' | 'itemId'> : never;
export type HarnessEventBody = Body<HarnessEvent>;

/** 프롬프트 1회 동안의 변환 상태 (도구 호출 이름·누적 텍스트) */
export class AcpEventMapper {
  private readonly tools = new Map<string, string>();
  private readonly finished = new Set<string>();
  private text = '';

  /** 누적된 assistant 텍스트 (turn 끝에 partial:false로 한 번 더 낸다) */
  get fullText(): string {
    return this.text;
  }

  map(update: acp.SessionUpdate): HarnessEventBody[] {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const t = contentText(update.content);
        if (!t) return [];
        this.text += t;
        return [{ type: 'assistant_text', text: t, partial: true }];
      }
      case 'tool_call': {
        const tool = update.name ?? update.kind ?? update.title ?? 'tool';
        this.tools.set(update.toolCallId, tool);
        const out: HarnessEventBody[] = [
          {
            type: 'tool_call',
            callId: update.toolCallId,
            tool,
            input: update.rawInput ?? { title: update.title },
          },
        ];
        out.push(...this.finish(update));
        return out;
      }
      case 'tool_call_update': {
        const out: HarnessEventBody[] = [];
        if (!this.tools.has(update.toolCallId)) {
          // tool_call 없이 update만 온 경우에도 호출 이벤트를 먼저 만든다
          const tool = update.name ?? update.kind ?? update.title ?? 'tool';
          this.tools.set(update.toolCallId, tool);
          out.push({ type: 'tool_call', callId: update.toolCallId, tool, input: update.rawInput ?? {} });
        }
        out.push(...this.finish(update));
        return out;
      }
      default:
        return [];
    }
  }

  /** completed/failed 상태면 diff → file_change, 결과 → tool_result */
  private finish(u: acp.ToolCallUpdate | acp.ToolCall): HarnessEventBody[] {
    if (u.status !== 'completed' && u.status !== 'failed') return [];
    if (this.finished.has(u.toolCallId)) return [];
    this.finished.add(u.toolCallId);
    const out: HarnessEventBody[] = [];
    for (const c of u.content ?? []) {
      if (c.type !== 'diff' || u.status !== 'completed') continue;
      out.push({
        type: 'file_change',
        path: c.path,
        change: c.oldText === undefined || c.oldText === null ? 'create' : 'modify',
        diff: c.newText,
      });
    }
    out.push({
      type: 'tool_result',
      callId: u.toolCallId,
      ok: u.status === 'completed',
      output: u.rawOutput ?? contentSummary(u.content ?? undefined),
    });
    return out;
  }
}

export function contentText(c: acp.ContentBlock): string {
  return c.type === 'text' ? c.text : '';
}

function contentSummary(content: acp.ToolCallContent[] | undefined): unknown {
  if (!content?.length) return null;
  const texts = content.flatMap((c) => (c.type === 'content' ? [contentText(c.content)] : []));
  return texts.length ? texts.join('') : content;
}

/** ACP StopReason → turn_end.reason */
export function mapStopReason(r: acp.StopReason): TurnEndEvent['reason'] {
  switch (r) {
    case 'end_turn':
      return 'completed';
    case 'cancelled':
      return 'interrupted';
    case 'max_tokens':
    case 'max_turn_requests':
      return 'max_turns';
    case 'refusal':
      return 'blocked';
    default:
      return 'completed';
  }
}
