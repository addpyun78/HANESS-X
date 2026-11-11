import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPROVAL_RESOLVED_TYPE, ApprovalRequestEventSchema } from '@harness-x/protocol';
import {
  CHOICE_LABELS,
  ChoiceIdSchema,
  parseApprovalCard,
  screenText,
  type ApprovalCard,
  type CardKind,
  type ChoiceId,
} from './card.js';

/**
 * 승인 카드 저장소 (T-100 H.10·H.22~H.25)
 *   <dir>/approval-cards.json  카드와 상태 (pending | resolved)
 *   <dir>/approvals.jsonl      결정 기록 1건 = 1줄 (시각, 카드 id, 선택, remember, 화면 문구 원문)
 * 자동 승인은 없다. 시간이 지나면 알림만 다시 보낸다 (30분·2시간).
 */

export const APPROVAL_CARDS_FILE = 'approval-cards.json';
export const APPROVALS_LOG_FILE = 'approvals.jsonl';
export const APPROVAL_CARD_KIND = 'approval.card';
/** H.22 재알림: 30분 · 2시간 (그 뒤로는 다시 보내지 않는다, 자동 승인 없음) */
export const REMIND_DELAYS_MS = [30 * 60_000, 2 * 60 * 60_000] as const;
/** H.25 같은 종류 카드가 이만큼 쌓이면 묶음 제안 */
export const BATCH_THRESHOLD = 5;
export const BATCH_MESSAGE = '비슷한 확인이 반복돼요 — 한 번에 정할까요?';

export type CardStatus = 'pending' | 'resolved';

export interface StoredCard {
  card: ApprovalCard;
  status: CardStatus;
  choice?: ChoiceId;
  remember?: boolean;
  by?: string;
  resolvedAt?: string;
}

export interface DecisionRecord {
  type: 'decision';
  ts: string;
  cardId: string;
  itemId: string;
  kind: CardKind;
  choice: ChoiceId;
  choiceLabel: string;
  remember: boolean;
  by: string;
  /** 화면 문구 원문 */
  text: string;
}

export interface UndoRecord {
  type: 'undo';
  ts: string;
  cardId: string;
  choice: ChoiceId;
}

export interface ChoiceContext {
  remember: boolean;
  by: string;
}

/** 선택 처리 결과 (handlers.ts). undo는 같은 세션 안에서 "방금 선택 취소"에 쓴다 */
export interface ChoiceOutcome {
  /** 사람에게 보여 줄 쉬운 말 안내 (예: "이 부분은 멈춰 두고 나머지를 먼저 진행할게요.") */
  message?: string;
  [k: string]: unknown;
  undo?: () => void;
}

export type ChoiceHandler = (
  card: ApprovalCard,
  choice: ChoiceId,
  ctx: ChoiceContext,
) => ChoiceOutcome | void;

export interface EventSinkLike {
  append(event: never): unknown;
}

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ApprovalStoreOptions {
  /** 저장 폴더 (보통 세션 폴더 <workspace>/.harness-x/sessions/<id>) */
  dir: string;
  sessionId?: string;
  /** approval_request / approval_resolved 이벤트 (WebSocket /ws/events로 나간다) */
  log?: EventSinkLike;
  /** 선택 반영 (체크리스트·사전). 없으면 기록만 */
  handler?: ChoiceHandler;
  /** 재알림 간격 (기본 30분·2시간). 빈 배열이면 재알림 없음 */
  remindDelaysMs?: readonly number[];
  /** 재알림 때 부른다 (알림 n번째, 1부터) */
  onRemind?: (card: ApprovalCard, n: number) => void;
  timers?: TimerApi;
  batchThreshold?: number;
  now?: () => Date;
  idGen?: () => string;
}

export interface BatchSuggestion {
  kind: CardKind;
  count: number;
  cardIds: string[];
  message: string;
}

export interface ResolveResult {
  card: ApprovalCard;
  choice: ChoiceId;
  remember: boolean;
  record: DecisionRecord;
  outcome: ChoiceOutcome;
}

export class ApprovalCardError extends Error {
  constructor(
    readonly code: 'APPROVAL_NOT_FOUND' | 'APPROVAL_RESOLVED' | 'INVALID_CHOICE' | 'NOTHING_TO_UNDO',
    message: string,
  ) {
    super(message);
    this.name = 'ApprovalCardError';
  }
}

export function createApprovalStore(opts: ApprovalStoreOptions) {
  const cardsFile = join(opts.dir, APPROVAL_CARDS_FILE);
  const logFile = join(opts.dir, APPROVALS_LOG_FILE);
  const now = opts.now ?? (() => new Date());
  const idGen = opts.idGen ?? randomUUID;
  const timers: TimerApi = opts.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const delays = opts.remindDelaysMs ?? REMIND_DELAYS_MS;
  const threshold = opts.batchThreshold ?? BATCH_THRESHOLD;
  const reminders = new Map<string, unknown[]>();
  /** 이 세션(이 저장소 인스턴스)에서 내린 결정 — "방금 선택 취소"용 */
  const undoStack: { cardId: string; choice: ChoiceId; undo?: () => void }[] = [];

  const readAll = (): Record<string, StoredCard> => {
    if (!existsSync(cardsFile)) return {};
    const raw = JSON.parse(readFileSync(cardsFile, 'utf8')) as { cards: Record<string, StoredCard> };
    return raw.cards;
  };
  const writeAll = (cards: Record<string, StoredCard>) => {
    mkdirSync(opts.dir, { recursive: true });
    const tmp = `${cardsFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, cards }, null, 2) + '\n');
    renameSync(tmp, cardsFile);
  };
  const appendLog = (rec: DecisionRecord | UndoRecord) => {
    mkdirSync(opts.dir, { recursive: true });
    appendFileSync(logFile, JSON.stringify(rec) + '\n');
  };
  const sessionOf = (card: ApprovalCard) => card.sessionId ?? opts.sessionId ?? 'default';

  const emitRequest = (card: ApprovalCard, extra: Record<string, unknown> = {}) => {
    if (!opts.log) return;
    const ev = ApprovalRequestEventSchema.parse({
      id: idGen(),
      ts: now().toISOString(),
      sessionId: sessionOf(card),
      itemId: card.itemId,
      type: 'approval_request',
      approvalId: card.id,
      kind: APPROVAL_CARD_KIND,
      title: card.title,
      detail: { card, ...extra },
      options: card.options.map((o) => o.id),
    });
    opts.log.append(ev as never);
  };
  const emitResolved = (card: ApprovalCard, choice: ChoiceId, remember: boolean, undone = false) => {
    opts.log?.append({
      id: idGen(),
      ts: now().toISOString(),
      sessionId: sessionOf(card),
      itemId: card.itemId,
      type: APPROVAL_RESOLVED_TYPE,
      approvalId: card.id,
      choice,
      remember,
      ...(undone ? { undone: true } : {}),
    } as never);
  };

  const cancelReminders = (id: string) => {
    for (const h of reminders.get(id) ?? []) timers.clearTimeout(h);
    reminders.delete(id);
  };
  const scheduleReminders = (card: ApprovalCard) => {
    cancelReminders(card.id);
    const hs = delays.map((ms, i) =>
      timers.setTimeout(() => {
        // 알림만 다시 보낸다. 상태는 절대 바꾸지 않는다 (H.22)
        if (readAll()[card.id]?.status !== 'pending') return;
        emitRequest(card, { reminder: i + 1 });
        opts.onRemind?.(card, i + 1);
      }, ms),
    );
    reminders.set(card.id, hs);
  };

  const store = {
    dir: opts.dir,
    cardsFile,
    logFile,

    /** 카드 추가 → approval_request 이벤트 + 재알림 예약. 같은 종류가 쌓였으면 묶음 제안 */
    add(input: unknown): { card: ApprovalCard; batch?: BatchSuggestion } {
      const card = parseApprovalCard(input);
      const all = readAll();
      all[card.id] = { card, status: 'pending' };
      writeAll(all);
      emitRequest(card);
      scheduleReminders(card);
      const batch = store.batchSuggestions().find((b) => b.kind === card.kind);
      return { card, ...(batch ? { batch } : {}) };
    },

    get(id: string): StoredCard {
      const s = readAll()[id];
      if (!s) throw new ApprovalCardError('APPROVAL_NOT_FOUND', `없는 승인 카드: ${id}`);
      return s;
    },

    list(status: CardStatus | 'all' = 'pending'): StoredCard[] {
      return Object.values(readAll())
        .filter((s) => status === 'all' || s.status === status)
        .sort((a, b) => a.card.createdAt.localeCompare(b.card.createdAt));
    },

    pending(): ApprovalCard[] {
      return store.list('pending').map((s) => s.card);
    },

    /** H.25 같은 종류 카드가 기준 이상 쌓였는가 */
    batchSuggestions(): BatchSuggestion[] {
      const by = new Map<CardKind, string[]>();
      for (const c of store.pending()) by.set(c.kind, [...(by.get(c.kind) ?? []), c.id]);
      return [...by.entries()]
        .filter(([, ids]) => ids.length >= threshold)
        .map(([kind, ids]) => ({ kind, count: ids.length, cardIds: ids, message: BATCH_MESSAGE }));
    },

    /** 사람의 선택 반영 (버튼·CLI·API) */
    resolve(id: string, choiceIn: string, meta: { remember?: boolean; by?: string } = {}): ResolveResult {
      const stored = store.get(id);
      if (stored.status !== 'pending')
        throw new ApprovalCardError('APPROVAL_RESOLVED', `이미 처리된 승인 카드: ${id}`);
      const parsed = ChoiceIdSchema.safeParse(choiceIn);
      const card = stored.card;
      if (!parsed.success || !card.options.some((o) => o.id === parsed.data))
        throw new ApprovalCardError(
          'INVALID_CHOICE',
          `이 카드의 선택지가 아닙니다: ${choiceIn} (가능: ${card.options.map((o) => o.id).join(', ')})`,
        );
      const choice = parsed.data;
      const remember = card.rememberable && meta.remember === true && choice === 'accept';
      const by = meta.by ?? 'human';
      const outcome = opts.handler?.(card, choice, { remember, by }) ?? {};
      const record: DecisionRecord = {
        type: 'decision',
        ts: now().toISOString(),
        cardId: card.id,
        itemId: card.itemId,
        kind: card.kind,
        choice,
        choiceLabel: CHOICE_LABELS[choice],
        remember,
        by,
        text: screenText(card),
      };
      appendLog(record);
      const all = readAll();
      all[id] = { ...stored, status: 'resolved', choice, remember, by, resolvedAt: record.ts };
      writeAll(all);
      cancelReminders(id);
      undoStack.push({ cardId: id, choice, ...(outcome.undo ? { undo: outcome.undo } : {}) });
      emitResolved(card, choice, remember);
      const { undo: _u, ...shown } = outcome;
      return { card, choice, remember, record, outcome: shown };
    },

    /** H.25 묶음 결정: 같은 종류의 대기 카드 전부에 같은 선택 */
    resolveBatch(
      kind: CardKind,
      choice: string,
      meta: { remember?: boolean; by?: string } = {},
    ): ResolveResult[] {
      return store
        .pending()
        .filter((c) => c.kind === kind)
        .map((c) => store.resolve(c.id, choice, meta));
    },

    /** 이 세션에서 취소할 수 있는 마지막 결정 */
    lastUndoable(): { cardId: string; choice: ChoiceId } | undefined {
      const last = undoStack.at(-1);
      return last ? { cardId: last.cardId, choice: last.choice } : undefined;
    },

    /** H.23 "방금 선택 취소": 항목 상태·사전 저장을 되돌리고 카드를 다시 대기로 */
    undo(): ApprovalCard {
      const last = undoStack.pop();
      if (!last) throw new ApprovalCardError('NOTHING_TO_UNDO', '취소할 선택이 없습니다');
      last.undo?.();
      const all = readAll();
      const s = all[last.cardId]!;
      all[last.cardId] = { card: s.card, status: 'pending' };
      writeAll(all);
      appendLog({ type: 'undo', ts: now().toISOString(), cardId: last.cardId, choice: last.choice });
      emitResolved(s.card, last.choice, false, true);
      emitRequest(s.card);
      scheduleReminders(s.card);
      return s.card;
    },

    /** approvals.jsonl 전체 */
    records(): (DecisionRecord | UndoRecord)[] {
      if (!existsSync(logFile)) return [];
      return readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as DecisionRecord | UndoRecord);
    },

    /** 재알림 타이머 정리 */
    dispose(): void {
      for (const id of [...reminders.keys()]) cancelReminders(id);
    },
  };
  return store;
}

export type ApprovalStore = ReturnType<typeof createApprovalStore>;
