import type { HarnessEvent } from '@harness-x/protocol';
import { pauseMarkFrom, type PauseMarkBlock } from './pause-timeline.js';

/**
 * HarnessEvent 9종 → 채팅 메시지 블록.
 * - assistant_text: 연속된 partial 조각은 한 블록으로 합치고, 최종 텍스트(partial 아님)가 오면 그것으로 확정
 * - tool_call + tool_result: callId로 짝지어 도구 카드 하나로 (짝 없는 결과는 단독 블록)
 * - turn_end(reason: 'blocked'): "종료 차단" 카드. 남은 항목 수·다음 항목은 이벤트의 확장 필드
 *   (remaining, nextItemId, nextItemTitle) — 종료 차단 훅(T-028)이 붙인다
 */

interface Base {
  id: string;
  ts: string;
  engineId?: string;
  itemId?: string;
}

export type ChatBlock =
  | (Base & { kind: 'text'; text: string; streaming: boolean })
  | (Base & {
      kind: 'tool';
      callId: string;
      tool: string;
      input: unknown;
      result?: { ok: boolean; output: unknown };
    })
  | (Base & { kind: 'tool_result'; callId: string; ok: boolean; output: unknown })
  | (Base & {
      kind: 'file';
      path: string;
      change: 'create' | 'modify' | 'delete' | 'rename';
      fromPath?: string;
      diff?: string;
    })
  | (Base & {
      kind: 'usage';
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      costUsd?: number;
      quotaRatio?: number;
    })
  | (Base & { kind: 'error'; code: string; message: string; retryable?: boolean })
  | (Base & { kind: 'turn_end'; reason: 'completed' | 'interrupted' | 'error' | 'max_turns' })
  | (Base & { kind: 'stop_block'; remaining?: number; nextItemId?: string; nextItemTitle?: string })
  | (Base & {
      kind: 'approval';
      approvalId: string;
      approvalKind: string;
      title: string;
      detail?: Record<string, unknown>;
      options: string[];
    })
  | (Base & { kind: 'checklist'; changedItemId: string; from: string | null; to: string; version: number })
  /** T-101 2B.12 "멈춤 → 이어감" 표시 줄 */
  | PauseMarkBlock;

export type ChatBlockKind = ChatBlock['kind'];

/** 종료 차단 이벤트의 확장 필드 */
export interface StopBlockExtra {
  remaining?: number;
  nextItemId?: string;
  nextItemTitle?: string;
}

const base = (e: HarnessEvent): Base => ({
  id: e.id,
  ts: e.ts,
  ...(e.engineId ? { engineId: e.engineId } : {}),
  ...(e.itemId ? { itemId: e.itemId } : {}),
});

export function eventsToBlocks(events: readonly HarnessEvent[]): ChatBlock[] {
  const out: ChatBlock[] = [];
  const tools = new Map<string, Extract<ChatBlock, { kind: 'tool' }>>();
  for (const e of events) {
    // T-101 2B.12 session_paused / session_resumed (커널 기록) → 타임라인 표시 줄
    const mark = pauseMarkFrom(e);
    if (mark) {
      out.push(mark);
      continue;
    }
    switch (e.type) {
      case 'assistant_text': {
        const last = out[out.length - 1];
        if (last?.kind === 'text' && last.streaming && last.engineId === e.engineId) {
          out[out.length - 1] = {
            ...last,
            text: e.partial ? last.text + e.text : e.text,
            streaming: !!e.partial,
          };
        } else out.push({ ...base(e), kind: 'text', text: e.text, streaming: !!e.partial });
        break;
      }
      case 'tool_call': {
        const b = { ...base(e), kind: 'tool' as const, callId: e.callId, tool: e.tool, input: e.input };
        tools.set(e.callId, b);
        out.push(b);
        break;
      }
      case 'tool_result': {
        const call = tools.get(e.callId);
        if (call) {
          const i = out.indexOf(call);
          const merged = { ...call, result: { ok: e.ok, output: e.output } };
          tools.set(e.callId, merged);
          out[i] = merged;
        } else out.push({ ...base(e), kind: 'tool_result', callId: e.callId, ok: e.ok, output: e.output });
        break;
      }
      case 'file_change':
        out.push({
          ...base(e),
          kind: 'file',
          path: e.path,
          change: e.change,
          ...(e.fromPath ? { fromPath: e.fromPath } : {}),
          ...(e.diff !== undefined ? { diff: e.diff } : {}),
        });
        break;
      case 'usage':
        out.push({
          ...base(e),
          kind: 'usage',
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
          ...(e.cacheReadTokens !== undefined ? { cacheReadTokens: e.cacheReadTokens } : {}),
          ...(e.costUsd !== undefined ? { costUsd: e.costUsd } : {}),
          ...(e.quotaRatio !== undefined ? { quotaRatio: e.quotaRatio } : {}),
        });
        break;
      case 'error':
        out.push({
          ...base(e),
          kind: 'error',
          code: e.code,
          message: e.message,
          ...(e.retryable !== undefined ? { retryable: e.retryable } : {}),
        });
        break;
      case 'turn_end':
        if (e.reason === 'blocked') {
          const x = e as typeof e & StopBlockExtra;
          out.push({
            ...base(e),
            kind: 'stop_block',
            ...(typeof x.remaining === 'number' ? { remaining: x.remaining } : {}),
            ...(typeof x.nextItemId === 'string' ? { nextItemId: x.nextItemId } : {}),
            ...(typeof x.nextItemTitle === 'string' ? { nextItemTitle: x.nextItemTitle } : {}),
          });
        } else out.push({ ...base(e), kind: 'turn_end', reason: e.reason });
        break;
      case 'approval_request':
        out.push({
          ...base(e),
          kind: 'approval',
          approvalId: e.approvalId,
          approvalKind: e.kind,
          title: e.title,
          ...(e.detail ? { detail: e.detail } : {}),
          options: e.options,
        });
        break;
      case 'checklist_change':
        out.push({
          ...base(e),
          kind: 'checklist',
          changedItemId: e.changedItemId,
          from: e.from,
          to: e.to,
          version: e.version,
        });
        break;
    }
  }
  return out;
}

// ── 32.3 보기 모드 ───────────────────────────────────────────────
export type ViewMode = 'verbose' | 'normal' | 'summary';

export const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  verbose: '자세히',
  normal: '보통',
  summary: '요약',
};

/** 모드별로 보이는 블록 종류 */
export const MODE_KINDS: Record<ViewMode, ReadonlySet<ChatBlockKind>> = {
  verbose: new Set<ChatBlockKind>([
    'text',
    'tool',
    'tool_result',
    'file',
    'usage',
    'error',
    'turn_end',
    'stop_block',
    'approval',
    'checklist',
    'pause_mark',
  ]),
  normal: new Set<ChatBlockKind>([
    'text',
    'tool',
    'tool_result',
    'file',
    'error',
    'stop_block',
    'approval',
    'pause_mark',
  ]),
  summary: new Set<ChatBlockKind>(['text', 'error', 'stop_block', 'approval', 'pause_mark']),
};

export function visibleBlocks(blocks: readonly ChatBlock[], mode: ViewMode): ChatBlock[] {
  const kinds = MODE_KINDS[mode];
  return blocks.filter((b) => kinds.has(b.kind));
}
