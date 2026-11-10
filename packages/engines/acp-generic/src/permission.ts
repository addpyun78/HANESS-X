import { randomUUID } from 'node:crypto';
import type * as acp from '@agentclientprotocol/sdk';
import type { BlockingOutcome, HookBus, HookDecision } from '@harness-x/kernel';
import type { PermissionHandler } from './adapter.js';

/**
 * 18.2 ACP 권한 요청(session/request_permission) → 하네스 권한 게이트.
 * permission-gate 플러그인(T-024)은 HookBus `tool.before`(차단형)에 등록되므로 여기서는 그 훅을 돌린다.
 * - allow → 에이전트가 준 allow 옵션 선택
 * - deny  → reject 옵션 선택 (사용자에게 묻지 않음)
 * - block → 사람에게 묻는다: approval_request 이벤트를 내고 respondApproval()의 선택을 그대로 돌려준다
 */

export const ACP_APPROVAL_KIND = 'acp_permission';

export interface HookPermissionGateOptions {
  hooks?: HookBus;
  /** 훅 버스가 없을 때의 결정 (기본 block = 사람에게 묻기) */
  whenNoHooks?: HookDecision;
}

const ALLOW_KINDS: acp.PermissionOptionKind[] = ['allow_once', 'allow_always'];
const REJECT_KINDS: acp.PermissionOptionKind[] = ['reject_once', 'reject_always'];

function pick(
  options: acp.PermissionOption[],
  kinds: acp.PermissionOptionKind[],
): acp.PermissionOption | undefined {
  for (const k of kinds) {
    const o = options.find((x) => x.kind === k);
    if (o) return o;
  }
  return undefined;
}

const selected = (optionId: string): acp.RequestPermissionResponse => ({
  outcome: { outcome: 'selected', optionId },
});
const cancelled = (): acp.RequestPermissionResponse => ({ outcome: { outcome: 'cancelled' } });

export function toolNameOf(tc: acp.ToolCallUpdate): string {
  return tc.name ?? tc.kind ?? tc.title ?? 'tool';
}

export function hookPermissionGate(opts: HookPermissionGateOptions = {}): PermissionHandler {
  return async (req, ctx) => {
    const tc = req.toolCall;
    const tool = toolNameOf(tc);
    const input = tc.rawInput ?? {};
    const outcome: Pick<BlockingOutcome, 'decision' | 'reason' | 'hookId'> = opts.hooks
      ? await opts.hooks.runBlocking('tool.before', {
          sessionId: ctx.sessionId,
          engineId: ctx.engineId,
          ...(ctx.itemId ? { itemId: ctx.itemId } : {}),
          callId: tc.toolCallId,
          tool,
          input,
          title: tc.title ?? undefined,
          source: 'acp',
          permissionOptions: req.options.map((o) => ({ id: o.optionId, kind: o.kind })),
        })
      : { decision: opts.whenNoHooks ?? 'block', reason: 'permission-gate 없음' };

    if (outcome.decision === 'allow') {
      const o = pick(req.options, ALLOW_KINDS);
      return o ? selected(o.optionId) : cancelled();
    }
    if (outcome.decision === 'deny') {
      const o = pick(req.options, REJECT_KINDS);
      return o ? selected(o.optionId) : cancelled();
    }

    // block → 사람 승인 (선택지가 없으면 물을 수 없으므로 취소)
    if (!req.options.length) return cancelled();
    const approvalId = randomUUID();
    ctx.emit({
      type: 'approval_request',
      approvalId,
      kind: ACP_APPROVAL_KIND,
      title: tc.title ?? tool,
      detail: {
        callId: tc.toolCallId,
        tool,
        input,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        ...(outcome.hookId ? { hookId: outcome.hookId } : {}),
        acpOptions: req.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind })),
      },
      options: req.options.map((o) => o.optionId),
    });
    const choice = await ctx.waitApproval(approvalId, ctx.signal);
    if (choice && req.options.some((o) => o.optionId === choice)) return selected(choice);
    return cancelled();
  };
}
