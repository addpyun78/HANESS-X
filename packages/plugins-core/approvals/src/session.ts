import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ChecklistLedger, manifestForLedger } from '@harness-x/checklist-ledger';
import { EQUIVALENCES_FILE, type DictionaryFiles } from './dictionary.js';
import { createLedgerHandler } from './handlers.js';
import {
  ApprovalCardError,
  APPROVAL_CARDS_FILE,
  createApprovalStore,
  type ApprovalStoreOptions,
  type CardStatus,
  type StoredCard,
} from './store.js';

/**
 * 워크스페이스 세션의 승인 카드 저장소
 *   카드·결정:   <workspace>/.harness-x/sessions/<id>/approval-cards.json · approvals.jsonl
 *   사전:        <workspace>/.harness-x/glossary.json · equivalences.json (프로젝트 공용)
 */

const SESSION_RE = /^[A-Za-z0-9._-]{1,128}$/;

export function sessionDir(workspace: string, sessionId: string): string {
  if (!SESSION_RE.test(sessionId) || sessionId === '.' || sessionId === '..')
    throw new Error(`잘못된 세션 id: ${sessionId}`);
  return join(workspace, '.harness-x', 'sessions', sessionId);
}

export function projectDictionary(workspace: string): Required<DictionaryFiles> {
  return {
    glossaryFile: join(workspace, '.harness-x', 'glossary.json'),
    equivalencesFile: join(workspace, '.harness-x', EQUIVALENCES_FILE),
  };
}

export function openSessionApprovals(
  workspace: string,
  sessionId: string,
  extra: Omit<ApprovalStoreOptions, 'dir' | 'sessionId' | 'handler'> = {},
) {
  const dir = sessionDir(workspace, sessionId);
  const dictionary = projectDictionary(workspace);
  const hasChecklist = existsSync(join(dir, 'checklist.json'));
  const ledger = hasChecklist
    ? new ChecklistLedger({ dir, sessionId, ...(extra.log ? { log: extra.log as never } : {}) })
    : undefined;
  const store = createApprovalStore({
    ...extra,
    dir,
    sessionId,
    ...(ledger
      ? { handler: createLedgerHandler({ ledger, manifest: manifestForLedger(ledger), dictionary }) }
      : {}),
  });
  return { store, ledger, dictionary, dir };
}

/** 카드가 있는 세션 id 목록 */
export function sessionsWithCards(workspace: string): string[] {
  const root = join(workspace, '.harness-x', 'sessions');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(
    (s) => SESSION_RE.test(s) && existsSync(join(root, s, APPROVAL_CARDS_FILE)),
  );
}

/**
 * 워크스페이스 전체 승인 카드 — 커널 API(GET/POST /api/approvals)의 approvalCards로 넘긴다.
 * 서버가 살아 있는 동안 저장소 인스턴스를 유지하므로 "방금 선택 취소"가 같은 세션 안에서 동작한다.
 */
export function workspaceApprovals(
  workspace: string,
  extra: Omit<ApprovalStoreOptions, 'dir' | 'sessionId' | 'handler'> = {},
) {
  const opened = new Map<string, ReturnType<typeof openSessionApprovals>>();
  const open = (sessionId: string) => {
    let o = opened.get(sessionId);
    if (!o) opened.set(sessionId, (o = openSessionApprovals(workspace, sessionId, extra)));
    return o;
  };
  const undoOrder: string[] = [];
  return {
    open,
    list(status: CardStatus | 'all' = 'pending'): (StoredCard & { sessionId: string })[] {
      return sessionsWithCards(workspace).flatMap((s) =>
        open(s)
          .store.list(status)
          .map((c) => ({ ...c, sessionId: s })),
      );
    },
    resolve(id: string, choice: string, meta: { remember?: boolean; by?: string } = {}) {
      for (const s of sessionsWithCards(workspace)) {
        const { store } = open(s);
        if (!store.list('all').some((c) => c.card.id === id)) continue;
        const r = store.resolve(id, choice, meta);
        undoOrder.push(s);
        return { card: r.card, choice: r.choice, remember: r.remember, outcome: r.outcome };
      }
      throw new ApprovalCardError('APPROVAL_NOT_FOUND', `없는 승인 카드: ${id}`);
    },
    undo() {
      const s = undoOrder.pop();
      if (!s) throw new ApprovalCardError('NOTHING_TO_UNDO', '취소할 선택이 없습니다');
      return open(s).store.undo();
    },
  };
}
