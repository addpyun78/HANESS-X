import {
  moveArtifact,
  statusOf,
  type Checklist,
  type ChecklistItem,
  type ChecklistLedger,
  type Evidence,
  type ItemStatus,
  type ManifestStore,
  type Verdict,
} from '@harness-x/checklist-ledger';
import type { ApprovalCard, ChoiceId } from './card.js';
import { CHOICE_LABELS } from './card.js';
import {
  restoreSnapshot,
  saveToDictionary,
  type DictionaryFiles,
  type DictionarySaveResult,
} from './dictionary.js';
import type { ChoiceContext, ChoiceHandler, ChoiceOutcome } from './store.js';

/**
 * 승인 카드 선택 → 체크리스트·사전 반영 (T-100 H.18~H.21, F.3)
 *   accept     → 항목 done + level: human (+ "다음부터 자동"이면 사전 저장)
 *   redo       → 항목 doing, 다음 턴 지시문에 쉬운 말 사유 + 정식 경로
 *   stop       → 그 항목만 blocked. 의존 항목은 대기, 독립 항목은 계속
 *   allow-move → manifest·참조 항목 일괄 갱신(T-027 moveArtifact) 후 done
 *   register   → (F.4 제안 카드) 사전 저장 / skip → 아무것도 하지 않음
 * 모든 선택은 되돌리기(undo)를 함께 돌려준다 (H.23).
 */

export const APPROVAL_CARD_EVIDENCE = 'approval_card';
export const REDO_EVIDENCE = 'approval_redo';
export const STOP_MESSAGE = '이 부분은 멈춰 두고 나머지를 먼저 진행할게요.';
export const ACCEPT_MESSAGE = '같은 걸로 인정하고 다음으로 넘어갈게요.';
export const REDO_MESSAGE = '원래 자리로 다시 만들도록 AI에게 전할게요.';
export const MOVE_MESSAGE = '옮긴 위치를 계획에 반영했어요.';
export const REGISTER_MESSAGE = '사전에 넣었어요. 다음부터는 묻지 않을게요.';
export const SKIP_MESSAGE = '사전에 넣지 않았어요.';

/** 원하는 상태까지 전이표를 따라 이동 (마지막 전이에 증거·판정을 붙인다) */
export function driveTo(
  ledger: ChecklistLedger,
  itemId: string,
  target: Extract<ItemStatus, 'done' | 'doing' | 'blocked'>,
  extra: { evidence: Evidence; verdict?: Verdict },
): void {
  const cur = ledger.item(itemId).status;
  const paths: Record<string, Partial<Record<ItemStatus, ItemStatus[]>>> = {
    done: {
      todo: ['doing', 'verifying', 'done'],
      doing: ['verifying', 'done'],
      verifying: ['done'],
      failed: ['doing', 'verifying', 'done'],
    },
    doing: { todo: ['doing'], verifying: ['failed', 'doing'], failed: ['doing'], doing: [] },
    blocked: { todo: ['blocked'], doing: ['blocked'], verifying: ['blocked'], failed: ['blocked'] },
  };
  const steps = paths[target]![cur];
  if (steps === undefined)
    throw new Error(`항목 ${itemId}: ${cur} 상태에서 ${target}(으)로 바꿀 수 없습니다`);
  if (steps.length === 0) {
    ledger.addEvidence(itemId, extra.evidence);
    return;
  }
  steps.forEach((to, i) => {
    const last = i === steps.length - 1;
    ledger.transition(
      itemId,
      to,
      last ? { evidence: extra.evidence, ...(extra.verdict ? { verdict: extra.verdict } : {}) } : {},
    );
  });
}

/** H.19 다음 턴 지시문: 쉬운 말 사유 + 정식 경로(또는 나와야 하는 값) */
export function redoInstruction(card: ApprovalCard): string {
  const { expected, actual } = card.technical;
  if (card.kind === 'path')
    return (
      `사용자가 "${actual}"에 만든 것은 계획과 다르다고 했어요. ` +
      `정식 경로에 다시 만들어 주세요.\n정식 경로: ${expected}`
    );
  return (
    `사용자가 "${actual}" 결과는 계획과 다르다고 했어요. ` +
    `계획대로 다시 만들어 주세요.\n나와야 하는 값: ${expected}`
  );
}

/** blocked 항목에 (직접·간접) 의존하는 항목 — 대기 */
export function dependentsOf(c: Checklist, itemId: string): string[] {
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const it of c.items)
      if (!out.has(it.id) && it.deps.some((d) => d === itemId || out.has(d))) {
        out.add(it.id);
        grew = true;
      }
  }
  return [...out];
}

export interface LedgerHandlerOptions {
  ledger: ChecklistLedger;
  /** allow-move에 필요 (없으면 allow-move는 오류) */
  manifest?: ManifestStore;
  /** "다음부터 자동"·사전 등록 저장 위치 */
  dictionary?: DictionaryFiles;
  now?: () => Date;
}

function restoreChecklist(ledger: ChecklistLedger, before: Checklist): void {
  ledger.store.update((cur) => ({ revision: cur?.revision ?? before.revision, items: before.items }));
}

export function createLedgerHandler(opts: LedgerHandlerOptions): ChoiceHandler {
  const { ledger } = opts;
  const now = opts.now ?? (() => new Date());
  const evidence = (
    card: ApprovalCard,
    choice: ChoiceId,
    ctx: ChoiceContext,
    more: Record<string, unknown> = {},
  ) => ({
    kind: APPROVAL_CARD_EVIDENCE,
    summary: `사용자 승인: ${CHOICE_LABELS[choice]}`,
    level: 'human',
    cardId: card.id,
    choice,
    remember: ctx.remember,
    by: ctx.by,
    ...more,
  });
  const save = (card: ApprovalCard, reason: string): DictionarySaveResult => {
    if (!opts.dictionary) throw new Error('사전 위치가 없어 "다음부터 자동"을 저장할 수 없습니다');
    return saveToDictionary(
      opts.dictionary,
      {
        kind: card.kind === 'dictionary-proposal' ? card.technical.comparator : card.kind,
        expected: card.technical.expected,
        actual: card.technical.actual,
        reason,
      },
      now(),
    );
  };

  return (card, choice, ctx): ChoiceOutcome => {
    if (card.kind === 'dictionary-proposal') {
      if (choice !== 'register') return { message: SKIP_MESSAGE };
      const saved = save(card, `사전 등록 제안 승인 (${ctx.by})`);
      return {
        message: REGISTER_MESSAGE,
        dictionary: { target: saved.target, glossaryAliases: saved.glossaryAliases, added: saved.added },
        undo: () => saved.snapshots.forEach(restoreSnapshot),
      };
    }

    const before = ledger.get();
    const item: ChecklistItem = ledger.item(card.itemId);
    switch (choice) {
      case 'accept': {
        const saved = ctx.remember
          ? save(card, `사용자 승인 (${ctx.by}): 같은 걸로 인정 + 다음부터 자동`)
          : undefined;
        driveTo(ledger, item.id, 'done', {
          evidence: evidence(card, choice, ctx, saved ? { dictionary: saved.target } : {}),
          verdict: {
            level: 5,
            verdict: 'equal',
            confidence: 1,
            reason: `사용자 승인(level: human): ${CHOICE_LABELS.accept}`,
          },
        });
        return {
          message: ACCEPT_MESSAGE,
          status: 'done',
          level: 'human',
          ...(saved
            ? {
                dictionary: {
                  target: saved.target,
                  glossaryAliases: saved.glossaryAliases,
                  added: saved.added,
                },
              }
            : {}),
          undo: () => {
            restoreChecklist(ledger, before);
            saved?.snapshots.forEach(restoreSnapshot);
          },
        };
      }
      case 'redo': {
        const instruction = redoInstruction(card);
        driveTo(ledger, item.id, 'doing', {
          evidence: evidence(card, choice, ctx, { kind: REDO_EVIDENCE, instruction }),
        });
        return {
          message: REDO_MESSAGE,
          status: 'doing',
          instruction,
          undo: () => restoreChecklist(ledger, before),
        };
      }
      case 'stop': {
        driveTo(ledger, item.id, 'blocked', { evidence: evidence(card, choice, ctx) });
        const st = statusOf(ledger.sessionId, ledger.read());
        return {
          message: STOP_MESSAGE,
          status: 'blocked',
          waiting: dependentsOf(ledger.get(), item.id),
          next: st.next ? st.next.id : null,
          undo: () => restoreChecklist(ledger, before),
        };
      }
      case 'allow-move': {
        if (!opts.manifest) throw new Error('파일 위치 목록이 없어 옮긴 위치를 반영할 수 없습니다');
        const from = card.technical.expected;
        const moved = moveArtifact({
          manifest: opts.manifest,
          ledger,
          artifactId: item.artifactId,
          newPath: card.technical.actual,
          reason: `사용자 승인 (${ctx.by}): 이동 허락 ${from} → ${card.technical.actual}`,
          now,
        });
        driveTo(ledger, item.id, 'done', {
          evidence: evidence(card, choice, ctx, { from, to: card.technical.actual }),
          verdict: {
            level: 5,
            verdict: 'relocated',
            confidence: 1,
            reason: `사용자 승인(level: human): ${CHOICE_LABELS['allow-move']}`,
          },
        });
        return {
          message: MOVE_MESSAGE,
          status: 'done',
          moved,
          undo: () => {
            moveArtifact({
              manifest: opts.manifest!,
              artifactId: item.artifactId,
              newPath: from,
              reason: `방금 선택 취소: ${card.technical.actual} → ${from}`,
              now,
            });
            restoreChecklist(ledger, before);
          },
        };
      }
      default:
        throw new Error(`이 카드에서 쓸 수 없는 선택: ${choice}`);
    }
  };
}
