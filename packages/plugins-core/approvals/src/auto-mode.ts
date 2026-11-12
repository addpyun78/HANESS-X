import type { ApprovalCard, ChoiceId } from './card.js';

/**
 * T-101 3D.3 오토 모드의 판정 승인 카드 자동 처리 — **안전한 선택만** 한다.
 *  - "원래 자리로 다시 만들기"(redo)만 자동으로 고른다. 같은 항목에서 최대 2회.
 *  - 그래도 안 맞거나 redo가 없는 카드면 항목을 blocked로 두고 "돌아오면 확인할 것"에 올린다.
 *  - "같은 걸로 인정"(accept)·"이 위치로 옮긴 걸 허락"·사전 등록은 절대 자동으로 고르지 않는다.
 */

export const AUTO_REDO_MAX = 2;

/** 오토가 스스로 고를 수 있는 선택지 (이 목록 밖은 사람만) */
export const AUTO_SAFE_CHOICES: readonly ChoiceId[] = Object.freeze(['redo']);

export type AutoCardDecision =
  { action: 'choose'; choice: 'redo'; attempt: number } | { action: 'block'; reason: string };

export const AUTO_CARD_BLOCK_REASON = '다시 만들어도 맞지 않아서 멈춰 뒀어요. 카드를 보고 정해 주세요.';
export const AUTO_CARD_NO_SAFE_REASON =
  '제가 대신 정하면 안 되는 확인이라 멈춰 뒀어요. 카드를 보고 정해 주세요.';

/** 순수 판단: 이 항목에서 이미 redo를 몇 번 했는지(redoCount)를 받아 결정 */
export function autoResolveCard(card: Pick<ApprovalCard, 'options'>, redoCount: number): AutoCardDecision {
  const canRedo = card.options.some((o) => o.id === 'redo');
  if (!canRedo) return { action: 'block', reason: AUTO_CARD_NO_SAFE_REASON };
  if (redoCount >= AUTO_REDO_MAX) return { action: 'block', reason: AUTO_CARD_BLOCK_REASON };
  return { action: 'choose', choice: 'redo', attempt: redoCount + 1 };
}

export interface AutoCardHandlerOptions {
  /** 카드 답 적용 (보통 approvals handlers.handle) */
  choose: (card: ApprovalCard, choice: 'redo') => Promise<void> | void;
  /** 항목 blocked + 확인 목록 */
  block: (card: ApprovalCard, reason: string) => Promise<void> | void;
}

/** 항목별 redo 횟수를 기억하는 처리기 */
export function createAutoCardHandler(opts: AutoCardHandlerOptions) {
  const redo = new Map<string, number>();
  return async (card: ApprovalCard): Promise<AutoCardDecision> => {
    const n = redo.get(card.itemId) ?? 0;
    const d = autoResolveCard(card, n);
    if (d.action === 'choose') {
      redo.set(card.itemId, n + 1);
      await opts.choose(card, d.choice);
    } else await opts.block(card, d.reason);
    return d;
  };
}
